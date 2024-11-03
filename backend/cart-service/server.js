const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const tracer = require('../shared/tracer');

const DB_PATH = path.join(__dirname, '../shared/db.json');

async function bootstrap() {
    // Initialize tracer with service name
    tracer.init('cart-service');

    const app = express();
    const port = process.env.PORT || 3003;

    app.use(cors());
    app.use(express.json());

    // Health check endpoint
    app.get('/api/health', (req, res) => {
        res.json({ status: 'healthy', service: 'cart-service' });
    });

    // DB helpers
    async function getDB() {
        const data = await fs.readFile(DB_PATH, 'utf8');
        return JSON.parse(data);
    }

    async function writeDB(data) {
        await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
    }

    // Get user's cart
    app.get('/api/cart/:userId', async (req, res) => {
        const span = tracer.startSpan('get-user-cart');
        try {
            const { userId } = req.params;
            span.setAttribute('user.id', userId);

            const db = await getDB();
            const cart = db.carts.find(c => c.userId === userId) || { userId, items: [] };

            // Get product details for each item
            const itemsWithDetails = await Promise.all(cart.items.map(async item => {
                const productResponse = await fetch(`http://product-service:3002/api/internal/products/${item.productId}/verify`);
                if (productResponse.ok) {
                    const { product } = await productResponse.json();
                    return {
                        ...item,
                        productName: product.name,
                        price: product.price
                    };
                }
                return item;
            }));

            cart.items = itemsWithDetails;
            span.setAttribute('cart.items.count', cart.items.length);
            res.json(cart);
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to fetch cart' });
        } finally {
            span.end();
        }
    });

    // Add/Update item in cart
    app.post('/api/cart/:userId/items', async (req, res) => {
        const span = tracer.startSpan('add-to-cart');
        try {
            const { userId } = req.params;
            const { productId, quantity } = req.body;

            span.setAttribute('user.id', userId);
            span.setAttribute('product.id', productId);
            span.setAttribute('quantity', quantity);

            // Verify product exists
            const productResponse = await fetch(`http://product-service:3002/api/internal/products/${productId}/verify`);
            if (!productResponse.ok) {
                span.setAttribute('product.found', false);
                return res.status(404).json({ error: 'Product not found' });
            }

            const db = await getDB();
            let cart = db.carts.find(c => c.userId === userId);

            if (!cart) {
                cart = { userId, items: [] };
                db.carts.push(cart);
            }

            const existingItem = cart.items.find(item => item.productId === productId);
            if (existingItem) {
                existingItem.quantity = quantity;
            } else {
                cart.items.push({ productId, quantity });
            }

            await writeDB(db);
            span.setAttribute('cart.items.count', cart.items.length);
            res.json(cart);
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to update cart' });
        } finally {
            span.end();
        }
    });

    // Remove item from cart
    app.delete('/api/cart/:userId/items/:productId', async (req, res) => {
        const span = tracer.startSpan('remove-from-cart');
        try {
            const { userId, productId } = req.params;
            span.setAttribute('user.id', userId);
            span.setAttribute('product.id', productId);

            const db = await getDB();
            const cart = db.carts.find(c => c.userId === userId);

            if (cart) {
                cart.items = cart.items.filter(item => item.productId !== productId);
                await writeDB(db);
                span.setAttribute('cart.items.count', cart.items.length);
                res.json(cart);
            } else {
                span.setAttribute('cart.found', false);
                res.status(404).json({ error: 'Cart not found' });
            }
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to remove item from cart' });
        } finally {
            span.end();
        }
    });

    // Clear cart
    app.delete('/api/cart/:userId', async (req, res) => {
        const span = tracer.startSpan('clear-cart');
        try {
            const { userId } = req.params;
            span.setAttribute('user.id', userId);

            const db = await getDB();
            const cartIndex = db.carts.findIndex(c => c.userId === userId);

            if (cartIndex !== -1) {
                db.carts.splice(cartIndex, 1);
                await writeDB(db);
                span.setAttribute('cart.cleared', true);
                res.json({ message: 'Cart cleared successfully' });
            } else {
                span.setAttribute('cart.found', false);
                res.status(404).json({ error: 'Cart not found' });
            }
        } catch (error) {
            span.recordException(error);
            res.status(500).json({ error: 'Failed to clear cart' });
        } finally {
            span.end();
        }
    });

    app.listen(port, () => {
        console.log(`Cart service running on port ${port}`);
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