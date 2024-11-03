const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const tracer = require('../shared/tracer');

const JWT_SECRET = 'your-secret-key';
const DB_PATH = path.join(__dirname, '../shared/db.json');

async function bootstrap() {
    // Initialize tracer with service name
    tracer.init('product-service');

    const app = express();
    const port = process.env.PORT || 3002;

    app.use(cors());
    app.use(express.json());

    // JWT verification middleware
    const verifyToken = (req, res, next) => {
        const span = tracer.startSpan('verify-token');
        try {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                span.setAttribute('auth.success', false);
                return res.status(401).json({ error: 'No token provided' });
            }

            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            span.setAttribute('auth.success', true);
            next();
        } catch (error) {
            span.recordException(error);
            res.status(401).json({ error: 'Invalid token' });
        } finally {
            span.end();
        }
    };

    // Health check endpoint (no auth required)
    app.get('/api/health', (req, res) => {
        res.json({ status: 'healthy', service: 'product-service' });
    });

    // DB helpers
    async function getDB() {
        const data = await fs.readFile(DB_PATH, 'utf8');
        return JSON.parse(data);
    }

    // Get all products (protected)
    app.get('/api/products', verifyToken, async (req, res) => {
        const span = tracer.startSpan('get-all-products');
        try {
            const db = await getDB();
            span.setAttribute('products.count', db.products.length);
            res.json(db.products);
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to fetch products' });
        } finally {
            span.end();
        }
    });

    // Get product by ID
    app.get('/api/products/:id', verifyToken, async (req, res) => {
        const span = tracer.startSpan('get-product-by-id');
        try {
            const { id } = req.params;
            span.setAttribute('product.id', id);

            const db = await getDB();
            const product = db.products.find(p => p.id === id);

            if (product) {
                span.setAttribute('product.found', true);
                res.json(product);
            } else {
                span.setAttribute('product.found', false);
                res.status(404).json({ error: 'Product not found' });
            }
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to fetch product' });
        } finally {
            span.end();
        }
    });

    // Check product availability
    app.get('/api/products/:id/availability', verifyToken, async (req, res) => {
        const span = tracer.startSpan('check-product-availability');
        try {
            const { id } = req.params;
            span.setAttribute('product.id', id);

            const db = await getDB();
            const product = db.products.find(p => p.id === id);

            if (product) {
                // Simulate random availability
                const isAvailable = Math.random() > 0.3;
                span.setAttribute('product.available', isAvailable);
                res.json({ available: isAvailable });
            } else {
                span.setAttribute('product.found', false);
                res.status(404).json({ error: 'Product not found' });
            }
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to check availability' });
        } finally {
            span.end();
        }
    });

    // Verify product exists (internal API)
    app.get('/api/internal/products/:id/verify', async (req, res) => {
        const span = tracer.startSpan('verify-product');
        try {
            const { id } = req.params;
            span.setAttribute('product.id', id);

            const db = await getDB();
            const product = db.products.find(p => p.id === id);

            if (product) {
                span.setAttribute('product.found', true);
                res.json({ exists: true, product });
            } else {
                span.setAttribute('product.found', false);
                res.status(404).json({ exists: false });
            }
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to verify product' });
        } finally {
            span.end();
        }
    });

    app.listen(port, () => {
        console.log(`Product service running on port ${port}`);
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