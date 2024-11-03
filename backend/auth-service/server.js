const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const tracer = require('../shared/tracer');

const JWT_SECRET = 'your-secret-key';  // In production, use environment variable
const DB_PATH = path.join(__dirname, '../shared/db.json');

async function bootstrap() {
    // Initialize tracer with service name
    tracer.init('auth-service');

    const app = express();
    const port = process.env.PORT || 3001;

    app.use(cors());
    app.use(express.json());

    // Health check endpoint
    app.get('/api/health', (req, res) => {
        res.json({ status: 'healthy', service: 'auth-service' });
    });

    // Login endpoint
    app.post('/api/auth/login', async (req, res) => {
        const span = tracer.startSpan('login-attempt');
        try {
            const { username, password } = req.body;
            span.setAttribute('username', username);

            // For demo, accept admin/admin
            if (username === 'admin' && password === 'admin') {
                const sessionId = require('crypto').randomUUID();
                const token = jwt.sign({ username, sessionId }, JWT_SECRET);

                const db = await getDB();
                db.sessions.push({
                    id: sessionId,
                    username,
                    createdAt: new Date().toISOString()
                });
                await writeDB(db);

                span.setAttribute('login.success', true);
                res.json({ token, sessionId });
            } else {
                span.setAttribute('login.success', false);
                res.status(401).json({ error: 'Invalid credentials' });
            }
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Login failed' });
        } finally {
            span.end();
        }
    });

    // Verify token endpoint
    app.get('/api/auth/verify', async (req, res) => {
        const span = tracer.startSpan('verify-token');
        try {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                span.setAttribute('token.valid', false);
                return res.status(401).json({ error: 'No token provided' });
            }

            const decoded = jwt.verify(token, JWT_SECRET);
            const db = await getDB();
            const session = db.sessions.find(s => s.id === decoded.sessionId);

            if (!session) {
                span.setAttribute('session.valid', false);
                return res.status(401).json({ error: 'Invalid session' });
            }

            span.setAttribute('token.valid', true);
            res.json({ username: decoded.username, sessionId: decoded.sessionId });
        } catch (error) {
            span.recordException(error);
            res.status(401).json({ error: 'Invalid token' });
        } finally {
            span.end();
        }
    });

    // Logout endpoint
    app.post('/api/auth/logout', async (req, res) => {
        const span = tracer.startSpan('logout');
        try {
            const { sessionId } = req.body;
            span.setAttribute('sessionId', sessionId);

            const db = await getDB();
            db.sessions = db.sessions.filter(s => s.id !== sessionId);
            await writeDB(db);

            span.setAttribute('logout.success', true);
            res.json({ message: 'Logged out successfully' });
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Logout failed' });
        } finally {
            span.end();
        }
    });

    // DB helpers
    async function getDB() {
        const data = await fs.readFile(DB_PATH, 'utf8');
        return JSON.parse(data);
    }

    async function writeDB(data) {
        await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
    }

    app.listen(port, () => {
        console.log(`Auth service running on port ${port}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        tracer.shutdown()
            .then(() => console.log('Tracer shut down successfully'))
            .catch(console.error)
            .finally(() => process.exit(0));
    });
}

bootstrap().catch(console.error); 