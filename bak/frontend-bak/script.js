// State management
let currentUser = null;
let cartItems = [];

// Add this helper function at the top of the file
async function pushToFaro(type, ...args) {
    try {
        const faro = await window.faroReady;
        if (type === 'error') {
            faro.api.pushError(...args);
        } else if (type === 'event') {
            faro.api.pushEvent(...args);
        }
    } catch (error) {
        console.error('Failed to push to Faro:', error);
    }
}

// Helper function to get auth headers
async function getAuthHeaders() {
    try {
        const faro = await window.faroReady;
        const traceContext = faro.getTraceContext() || {};
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'traceparent': traceContext.traceparent || '',
            'tracestate': traceContext.tracestate || ''
        };
    } catch (error) {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        };
    }
}

// Login form handler
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const formData = new FormData(e.target);
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
                userId: data.sessionId,
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

            await pushToFaro('event', 'user-logged-in', {
                username: currentUser.username
            });
        } else {
            throw new Error(data.error || 'Login failed');
        }
    } catch (error) {
        document.getElementById('status').textContent = `Login error: ${error.message}`;
        await pushToFaro('error', error);
    }
});

// Product loading
async function loadProducts() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/products', {
            headers: headers
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
    } catch (error) {
        document.getElementById('status').textContent = `Error loading products: ${error.message}`;
        await pushToFaro('error', error);
    }
}

// Cart management
async function loadCart() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/cart/${currentUser.userId}`, {
            headers: headers
        });
        const cart = await response.json();
        cartItems = cart.items || [];
        updateCartDisplay();
    } catch (error) {
        document.getElementById('status').textContent = `Error loading cart: ${error.message}`;
        await pushToFaro('error', error);
    }
}

async function addToCart(product) {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/cart/${currentUser.userId}/items`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                productId: product.id,
                quantity: 1
            })
        });

        if (!response.ok) throw new Error('Failed to add item to cart');
        await loadCart();

        await pushToFaro('event', 'add-to-cart', {
            productId: product.id,
            productName: product.name,
            price: product.price
        });
    } catch (error) {
        document.getElementById('status').textContent = `Error adding to cart: ${error.message}`;
        await pushToFaro('error', error);
    }
}

async function removeFromCart(productId) {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/cart/${currentUser.userId}/items/${productId}`, {
            method: 'DELETE',
            headers: headers
        });

        if (!response.ok) throw new Error('Failed to remove item from cart');
        await loadCart();
    } catch (error) {
        document.getElementById('status').textContent = `Error removing from cart: ${error.message}`;
        await pushToFaro('error', error);
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

async function updateQuantity(productId, change) {
    try {
        const headers = await getAuthHeaders();
        const item = cartItems.find(i => i.productId === productId);
        const newQuantity = Math.max(1, (item?.quantity || 1) + change);

        const response = await fetch(`/api/cart/${currentUser.userId}/items`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                productId,
                quantity: newQuantity
            })
        });

        if (!response.ok) throw new Error('Failed to update quantity');
        await loadCart();
    } catch (error) {
        document.getElementById('status').textContent = `Error updating quantity: ${error.message}`;
        await pushToFaro('error', error);
    }
}

// Order management
async function loadOrders() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/orders/${currentUser.userId}`, {
            headers: headers
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
    } catch (error) {
        document.getElementById('status').textContent = `Error loading orders: ${error.message}`;
        await pushToFaro('error', error);
    }
}

// Checkout handler
document.getElementById('checkoutButton').addEventListener('click', async () => {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`/api/orders/checkout/${currentUser.userId}`, {
            method: 'POST',
            headers: headers
        });

        if (!response.ok) throw new Error('Checkout failed');
        const order = await response.json();

        await pushToFaro('event', 'checkout-complete', {
            orderId: order.id,
            total: order.total,
            itemCount: order.items.length
        });

        await loadCart();
        await loadOrders();
        document.getElementById('status').textContent = 'Checkout successful!';
    } catch (error) {
        document.getElementById('status').textContent = `Checkout error: ${error.message}`;
        await pushToFaro('error', error);
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

// Add error tracking
window.addEventListener('error', async (event) => {
    await pushToFaro('error', event.error);
});

window.addEventListener('unhandledrejection', async (event) => {
    await pushToFaro('error', event.reason);
});
