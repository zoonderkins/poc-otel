import {
  ConsoleInstrumentation,
  ConsoleTransport,
  ErrorsInstrumentation,
  FetchTransport,
  initializeFaro,
  LogLevel,
  SessionInstrumentation,
  WebVitalsInstrumentation,
} from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

console.log('Starting Faro initialization...');

// Initialize Faro with tracing
const faroInstance = initializeFaro({
    instrumentations: [
        new ErrorsInstrumentation(),
        new WebVitalsInstrumentation(),
        new ConsoleInstrumentation({
            disabledLevels: [LogLevel.TRACE, LogLevel.ERROR], // console.log will be captured
        }),
        new SessionInstrumentation(),
        new TracingInstrumentation()
    ],
    transports: [
        new FetchTransport({
            url: '/collect',  // Using nginx proxy
            apiKey: 'asdf',
            headers: {
                'Content-Type': 'application/json'
            }
        }),
        new ConsoleTransport()  // Also log to console for debugging
    ],
    app: {
        name: 'frontend',
        version: '1.0.0',
    },
    beforeSend: (event) => {
        console.log('Sending event to Faro:', event);
        return event;
    }
});

// Log when Faro is initialized
console.log('Faro initialization complete:', {
    config: faroInstance.config
});

// Make faro globally available without making it read-only
window.faroInstance = faroInstance;

// Call demonstrateFaroFeatures directly after initialization
setTimeout(() => {
    console.log('Starting Faro features demonstration');
    demonstrateFaroFeatures();
}, 1000);

// Example function to demonstrate various Faro features
function demonstrateFaroFeatures() {
    // Send log messages
    faroInstance.api.pushLog(['User accessed the application'], {
        level: LogLevel.INFO,
        context: {
            ...getTraceContext(),
            timestamp: new Date().toISOString()
        }
    });

    // Log with context
    faroInstance.api.pushLog(['User attempted checkout'], {
        context: {
            cartItems: ['item1', 'item2'],
            totalAmount: 99.99
        },
        level: LogLevel.DEBUG
    });

    // Set user metadata
    faroInstance.api.setUser({
        email: 'user@example.com',
        id: 'user123',
        username: 'testUser',
        attributes: {
            role: 'customer',
            plan: 'premium'
        }
    });

    // Create and set session
    const session = {
        id: `session_${Date.now()}`,
        attributes: {
            startTime: new Date().toISOString(),
            userAgent: navigator.userAgent
        }
    };
    faroInstance.api.setSession(session);

    // Push custom measurements
    faroInstance.api.pushMeasurement({
        type: 'page-load',
        values: {
            loadTime: performance.now(),
            resourceCount: performance.getEntriesByType('resource').length
        }
    });
}

// Example of error handling
async function fetchData() {
    try {
        const response = await fetch('/api/test', {
            headers: getAuthHeaders()
        });
        const data = await response.json();
        faroInstance.api.pushEvent('data-fetch-success', { 
            endpoint: '/api/test',
            timestamp: Date.now()
        });
        return data;
    } catch (error) {
        faroInstance.api.pushError(error);
        faroInstance.api.pushLog(['API request failed'], {
            level: LogLevel.ERROR,
            context: { error }
        });
        throw error;
    }
}

// State management
let currentUser = null;
let cartItems = [];

// Get OpenTelemetry trace and context APIs first
const { trace, context } = faroInstance.api.getOTEL();
const tracer = trace.getTracer('frontend-tracer');

// Add removeFromCart function
async function removeFromCart(productId) {
    const span = tracer.startSpan('remove-from-cart');
    try {
        const response = await fetch(`/api/cart/${currentUser.userId}/items/${productId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to remove item from cart');
        await loadCart();
        
        span.setAttribute('product.id', productId);
        faroInstance.api.pushEvent('remove-from-cart', {
            productId,
            userId: currentUser.userId
        });
    } catch (error) {
        span.recordException(error);
        document.getElementById('status').textContent = `Error removing from cart: ${error.message}`;
    } finally {
        span.end();
    }
}

// UI Event Handlers
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Faro features
    demonstrateFaroFeatures();

    // Example of tracking navigation
    window.addEventListener('popstate', () => {
        faroInstance.api.pushEvent('navigation', {
            url: window.location.href,
            timestamp: Date.now()
        });
    });

    // Example of tracking user interactions
    document.addEventListener('click', (event) => {
        if (event.target.matches('button')) {
            faroInstance.api.pushEvent('button-click', {
                buttonId: event.target.id,
                buttonText: event.target.textContent,
                timestamp: Date.now()
            });
        }
    });

    // Example of performance monitoring
    window.addEventListener('load', () => {
        const performanceMetrics = {
            type: 'page-performance',
            values: {
                loadTime: performance.now(),
                domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
                firstContentfulPaint: performance.getEntriesByType('paint')[0]?.startTime || 0
            }
        };
        faroInstance.api.pushMeasurement(performanceMetrics);
    });

    // Add form submit handler
    const userForm = document.getElementById('userForm');
    if (userForm) {
        userForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(userForm);
            try {
                const userData = {
                    email: formData.get('email'),
                    username: formData.get('username')
                };
                const result = await createUser(userData);
                document.getElementById('status').textContent = `User created: ${result.userId}`;
            } catch (error) {
                document.getElementById('status').textContent = `Error: ${error.message}`;
            }
        });
    }

    // Add error simulation handler
    const errorButton = document.getElementById('simulateError');
    if (errorButton) {
        errorButton.addEventListener('click', async () => {
            try {
                await simulateError();
            } catch (error) {
                document.getElementById('status').textContent = `Error simulated: ${error.message}`;
            }
        });
    }

    // Login form handler
    const loginForm = document.getElementById('loginForm');
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const span = tracer.startSpan('login-attempt');
        try {
            const formData = new FormData(loginForm);
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: formData.get('username'),
                    password: formData.get('password')
                })
            });

            const data = await response.json();
            if (response.ok) {
                currentUser = {
                    userId: data.sessionId, // Use sessionId as userId
                    token: data.token,
                    username: formData.get('username')
                };
                localStorage.setItem('token', data.token);
                localStorage.setItem('userId', data.sessionId);
                
                document.getElementById('loginSection').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';
                
                await loadProducts();
                await loadCart();
                await loadOrders();

                span.setAttribute('login.success', true);
                faroInstance.api.pushEvent('user-logged-in', {
                    username: currentUser.username,
                    timestamp: Date.now()
                });
            } else {
                throw new Error(data.error || 'Login failed');
            }
        } catch (error) {
            span.recordException(error);
            span.setAttribute('login.success', false);
            document.getElementById('status').textContent = `Login error: ${error.message}`;
        } finally {
            span.end();
        }
    });

    // Tab switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`${tabId}Tab`).classList.add('active');
        });
    });

    // Checkout button
    document.getElementById('checkoutButton').addEventListener('click', handleCheckout);
});

// Product loading
async function loadProducts() {
    const span = tracer.startSpan('load-products');
    try {
        const response = await fetch('/api/products', {
            headers: getAuthHeaders()
        });
        const products = await response.json();
        
        const productList = document.getElementById('productList');
        productList.innerHTML = '';
        const template = document.getElementById('productTemplate');

        products.forEach(product => {
            const clone = template.content.cloneNode(true);
            clone.querySelector('.product-name').textContent = product.name;
            clone.querySelector('.product-description').textContent = product.description;
            clone.querySelector('.product-price').textContent = `$${product.price.toFixed(2)}`;
            clone.querySelector('.add-to-cart').onclick = () => addToCart(product);
            productList.appendChild(clone);
        });

        span.setAttribute('products.count', products.length);
    } catch (error) {
        span.recordException(error);
        document.getElementById('status').textContent = `Error loading products: ${error.message}`;
    } finally {
        span.end();
    }
}

// Cart management
async function loadCart() {
    const span = tracer.startSpan('load-cart');
    try {
        const response = await fetch(`/api/cart/${currentUser.userId}`, {
            headers: getAuthHeaders()
        });
        const cart = await response.json();
        cartItems = cart.items || [];
        updateCartDisplay();
        span.setAttribute('cart.items.count', cartItems.length);
    } catch (error) {
        span.recordException(error);
        document.getElementById('status').textContent = `Error loading cart: ${error.message}`;
    } finally {
        span.end();
    }
}

async function addToCart(product) {
    const span = tracer.startSpan('add-to-cart');
    try {
        const response = await fetch(`/api/cart/${currentUser.userId}/items`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ productId: product.id, quantity: 1 })
        });
        
        if (!response.ok) throw new Error('Failed to add item to cart');
        await loadCart();
        
        span.setAttribute('product.id', product.id);
        faroInstance.api.pushEvent('add-to-cart', {
            productId: product.id,
            productName: product.name,
            price: product.price
        });
    } catch (error) {
        span.recordException(error);
        document.getElementById('status').textContent = `Error adding to cart: ${error.message}`;
    } finally {
        span.end();
    }
}

function updateCartDisplay() {
    const cartItemsContainer = document.getElementById('cartItems');
    cartItemsContainer.innerHTML = '';
    const template = document.getElementById('cartItemTemplate');
    let total = 0;

    cartItems.forEach(item => {
        const clone = template.content.cloneNode(true);
        clone.querySelector('.item-name').textContent = item.productName;
        clone.querySelector('.quantity-value').textContent = item.quantity;
        clone.querySelector('.item-price').textContent = `$${(item.price * item.quantity).toFixed(2)}`;
        clone.querySelector('.remove-item').onclick = () => removeFromCart(item.productId);
        clone.querySelector('.decrease-quantity').onclick = () => updateQuantity(item.productId, -1);
        clone.querySelector('.increase-quantity').onclick = () => updateQuantity(item.productId, 1);
        cartItemsContainer.appendChild(clone);
        total += item.price * item.quantity;
    });

    document.getElementById('cartTotal').textContent = `Total: $${total.toFixed(2)}`;
}

async function handleCheckout() {
    const span = tracer.startSpan('checkout');
    try {
        const response = await fetch(`/api/orders/checkout/${currentUser.userId}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        if (!response.ok) throw new Error('Checkout failed');
        const order = await response.json();
        
        span.setAttribute('order.id', order.id);
        span.setAttribute('order.total', order.total);
        
        faroInstance.api.pushEvent('checkout-complete', {
            orderId: order.id,
            total: order.total,
            itemCount: order.items.length
        });

        await loadCart();
        await loadOrders();
        document.getElementById('status').textContent = 'Checkout successful!';
    } catch (error) {
        span.recordException(error);
        document.getElementById('status').textContent = `Checkout error: ${error.message}`;
    } finally {
        span.end();
    }
}

// Order history
async function loadOrders() {
    const span = tracer.startSpan('load-orders');
    try {
        const response = await fetch(`/api/orders/${currentUser.userId}`, {
            headers: getAuthHeaders()
        });
        const orders = await response.json();
        
        const orderList = document.getElementById('orderList');
        orderList.innerHTML = '';
        const template = document.getElementById('orderTemplate');

        orders.forEach(order => {
            const clone = template.content.cloneNode(true);
            clone.querySelector('.order-id').textContent = order.id;
            clone.querySelector('.order-date').textContent = new Date(order.createdAt).toLocaleString();
            clone.querySelector('.order-total').textContent = `$${order.total.toFixed(2)}`;
            orderList.appendChild(clone);
        });

        span.setAttribute('orders.count', orders.length);
    } catch (error) {
        span.recordException(error);
        document.getElementById('status').textContent = `Error loading orders: ${error.message}`;
    } finally {
        span.end();
    }
}

// Utility function to pause/resume monitoring
function toggleMonitoring(pause = true) {
    if (pause) {
        faroInstance.pause();
        faroInstance.api.pushLog(['Monitoring paused'], { level: LogLevel.INFO });
    } else {
        faroInstance.unpause();
        faroInstance.api.pushLog(['Monitoring resumed'], { level: LogLevel.INFO });
    }
}

// API interaction functions
async function createUser(userData) {
    const span = tracer.startSpan('create-user-request');
    const ctx = trace.setSpan(context.active(), span);
    
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(userData)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            try {
                const errorJson = JSON.parse(errorText);
                throw new Error(errorJson.error || 'Failed to create user');
            } catch (parseError) {
                throw new Error(errorText || 'Failed to create user');
            }
        }

        const data = await response.json();
        
        faroInstance.api.pushEvent('user-created', {
            userId: data.userId,
            timestamp: Date.now()
        });

        return data;
    } catch (error) {
        faroInstance.api.pushError(error);
        span.recordException(error);
        throw error;
    } finally {
        span.end();
    }
}

async function getUser(userId) {
    const span = tracer.startSpan('get-user-request');
    const ctx = trace.setSpan(context.active(), span);
    
    try {
        const response = await fetch(`/api/users/${userId}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch user');
        }

        faroInstance.api.pushEvent('user-fetched', {
            userId,
            timestamp: Date.now()
        });

        return data;
    } catch (error) {
        faroInstance.api.pushError(error);
        span.recordException(error);
        throw error;
    } finally {
        span.end();
    }
}

async function simulateError() {
    const span = tracer.startSpan('simulate-error-request');
    const ctx = trace.setSpan(context.active(), span);
    
    try {
        const response = await fetch('/api/simulate-error', {
            method: 'POST'
        });
        const data = await response.json();
        
        faroInstance.api.pushEvent('error-simulated', {
            timestamp: Date.now(),
            status: response.status
        });

        return data;
    } catch (error) {
        faroInstance.api.pushError(error);
        span.recordException(error);
        throw error;
    } finally {
        span.end();
    }
}

// Add quantity management to cart
async function updateQuantity(productId, change) {
    const span = tracer.startSpan('update-quantity');
    try {
        const item = cartItems.find(i => i.productId === productId);
        const newQuantity = Math.max(1, (item?.quantity || 1) + change);

        const response = await fetch(`/api/cart/${currentUser.userId}/items`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ productId, quantity: newQuantity })
        });

        if (!response.ok) throw new Error('Failed to update quantity');
        await loadCart();

        span.setAttribute('product.id', productId);
        span.setAttribute('quantity.change', change);
    } catch (error) {
        span.recordException(error);
        document.getElementById('status').textContent = `Error updating quantity: ${error.message}`;
    } finally {
        span.end();
    }
}

// Export the new functions
export { faroInstance, createUser, getUser, simulateError, toggleMonitoring };

// Test log to verify Loki pipeline
faroInstance.api.pushLog(['Faro initialization test log'], {
    level: LogLevel.INFO,
    context: {
        test: true,
        timestamp: new Date().toISOString()
    }
});

// Update the helper function to use active span
function getTraceContext() {
    const activeSpan = trace.getSpan(context.active());
    if (activeSpan) {
        const spanContext = activeSpan.spanContext();
        return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId
        };
    }
    return {};
}

// Add authorization header helper
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
    };
}