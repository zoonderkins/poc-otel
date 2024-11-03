const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const tracer = require('../shared/tracer');

const DB_PATH = path.join(__dirname, '../shared/db.json');

async function bootstrap() {
    // Initialize tracer with service name
    tracer.init('order-service');

    const app = express();
    const port = process.env.PORT || 3004;

    app.use(cors());
    app.use(express.json());

    // Health check endpoint
    app.get('/api/health', (req, res) => {
        res.json({ status: 'healthy', service: 'order-service' });
    });

    // DB helpers
    async function getDB() {
        const data = await fs.readFile(DB_PATH, 'utf8');
        return JSON.parse(data);
    }

    async function writeDB(data) {
        await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
    }

    // Create order from cart (checkout)
    app.post('/api/orders/checkout/:userId', async (req, res) => {
        const span = tracer.startSpan('create-order');
        try {
            const { userId } = req.params;
            span.setAttribute('user.id', userId);

            // Get cart
            const cartResponse = await fetch(`http://cart-service:3003/api/cart/${userId}`);
            if (!cartResponse.ok) {
                span.setAttribute('cart.found', false);
                return res.status(400).json({ error: 'Cart not found' });
            }

            const cart = await cartResponse.json();
            if (!cart.items || cart.items.length === 0) {
                span.setAttribute('cart.empty', true);
                return res.status(400).json({ error: 'Cart is empty' });
            }

            // Create order
            const order = {
                id: uuidv4(),
                userId,
                items: cart.items,
                total: cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
                status: 'created',
                createdAt: new Date().toISOString()
            };

            // Save order
            const db = await getDB();
            db.orders.push(order);
            await writeDB(db);

            // Clear cart
            await fetch(`http://cart-service:3003/api/cart/${userId}`, {
                method: 'DELETE'
            });

            span.setAttribute('order.id', order.id);
            span.setAttribute('order.total', order.total);
            span.setAttribute('order.items.count', order.items.length);

            res.status(201).json(order);
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to create order' });
        } finally {
            span.end();
        }
    });

    // Get user's orders
    app.get('/api/orders/:userId', async (req, res) => {
        const span = tracer.startSpan('get-user-orders');
        try {
            const { userId } = req.params;
            span.setAttribute('user.id', userId);

            const db = await getDB();
            const orders = db.orders.filter(o => o.userId === userId);
            
            // Sort orders by date (newest first)
            orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            span.setAttribute('orders.count', orders.length);
            res.json(orders);
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to fetch orders' });
        } finally {
            span.end();
        }
    });

    // Get specific order
    app.get('/api/orders/:userId/:orderId', async (req, res) => {
        const span = tracer.startSpan('get-order-details');
        try {
            const { userId, orderId } = req.params;
            span.setAttribute('user.id', userId);
            span.setAttribute('order.id', orderId);

            const db = await getDB();
            const order = db.orders.find(o => o.id === orderId && o.userId === userId);

            if (order) {
                span.setAttribute('order.found', true);
                res.json(order);
            } else {
                span.setAttribute('order.found', false);
                res.status(404).json({ error: 'Order not found' });
            }
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to fetch order' });
        } finally {
            span.end();
        }
    });

    app.listen(port, () => {
        console.log(`Order service running on port ${port}`);
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