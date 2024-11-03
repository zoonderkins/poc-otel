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
        const response = await fetch('http://localhost:3000/api/test');
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

// Event listeners for user interactions
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
});

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

// Get OpenTelemetry trace and context APIs
const { trace, context } = faroInstance.api.getOTEL();
const tracer = trace.getTracer('frontend-tracer');

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