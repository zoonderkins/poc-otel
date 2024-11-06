const express = require('express');
const cors = require('cors');
const opentelemetry = require('@opentelemetry/api');
const tracer = require('./tracer');

async function bootstrap() {
    // Initialize tracer
    tracer.init();

    const app = express();
    const port = process.env.PORT || 3000;

    app.use(cors());
    app.use(express.json());

    // Logging middleware
    app.use((req, res, next) => {
        const span = opentelemetry.trace.getActiveSpan();
        const traceId = span?.spanContext().traceId;
        const spanId = span?.spanContext().spanId;
        const start = Date.now();
        const oldEnd = res.end;

        // Log request with trace context
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            method: req.method,
            path: req.path,
            query: req.query,
            body: req.body,
            headers: req.headers,
            app_name: 'backend',
            traceId,
            spanId
        }));

        // Override res.end to log response with trace context
        res.end = function() {
            const duration = Date.now() - start;
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                duration: duration,
                app_name: 'backend',
                traceId,
                spanId
            }));
            oldEnd.apply(res, arguments);
        };

        next();
    });

    // Error logging middleware with trace context
    app.use((err, req, res, next) => {
        const span = opentelemetry.trace.getActiveSpan();
        const traceId = span?.spanContext().traceId;
        const spanId = span?.spanContext().spanId;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            error: err.message,
            stack: err.stack,
            method: req.method,
            path: req.path,
            app_name: 'backend',
            traceId,
            spanId
        }));
        next(err);
    });

    // Mock user database
    const users = new Map();

    // API Endpoints
    app.get('/api/health', (req, res) => {
        const tracer = opentelemetry.trace.getTracer('health-check');
        const span = tracer.startSpan('health-check');
        
        try {
            res.json({ status: 'healthy', timestamp: new Date().toISOString() });
        } finally {
            span.end();
        }
    });

    app.post('/api/users', (req, res) => {
        const tracer = opentelemetry.trace.getTracer('user-operations');
        const span = tracer.startSpan('create-user');
        
        try {
            const { email, username } = req.body;
            const userId = `user_${Date.now()}`;
            
            users.set(userId, {
                id: userId,
                email,
                username,
                createdAt: new Date().toISOString()
            });

            span.setAttribute('user.id', userId);
            res.status(201).json({ userId, message: 'User created successfully' });
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to create user' });
        } finally {
            span.end();
        }
    });

    app.get('/api/users/:userId', (req, res) => {
        const tracer = opentelemetry.trace.getTracer('user-operations');
        const span = tracer.startSpan('get-user');
        
        try {
            const { userId } = req.params;
            const user = users.get(userId);
            
            if (user) {
                span.setAttribute('user.found', true);
                res.json(user);
            } else {
                span.setAttribute('user.found', false);
                res.status(404).json({ error: 'User not found' });
            }
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to fetch user' });
        } finally {
            span.end();
        }
    });

    app.post('/api/simulate-error', (req, res) => {
        const tracer = opentelemetry.trace.getTracer('error-simulation');
        const span = tracer.startSpan('simulated-error');
        
        try {
            throw new Error('Simulated error for testing');
        } catch (error) {
            span.recordException(error);
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                error: error.message,
                stack: error.stack,
                app_name: 'backend'
            }));
            res.status(500).json({ error: 'Simulated error occurred' });
        } finally {
            span.end();
        }
    });

    app.listen(port, () => {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Backend server running on port ${port}`,
            app_name: 'backend'
        }));
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        try {
            await tracer.shutdown();
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                message: 'OpenTelemetry SDK shut down successfully',
                app_name: 'backend'
            }));
        } catch (error) {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                error: error.message,
                stack: error.stack,
                app_name: 'backend'
            }));
        } finally {
            process.exit(0);
        }
    });
}

// Start the application
bootstrap().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
});