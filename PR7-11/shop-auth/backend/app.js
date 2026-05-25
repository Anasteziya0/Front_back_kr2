const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const { createClient } = require('redis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== ПОДКЛЮЧЕНИЕ К PostgreSQL ==========
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://shop_user:shop_password@postgres:5432/shop_db',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ========== ПОДКЛЮЧЕНИЕ К Redis ==========
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));

async function initRedis() {
    await redisClient.connect();
    console.log('✅ Redis подключён');
}

// Секреты
const ACCESS_SECRET = process.env.ACCESS_SECRET || 'my_super_secret_access_key_2024';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'my_super_secret_refresh_key_2024';
const ACCESS_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_IN = '7d';

const ROLES = { BUYER: 'buyer', OPERATOR: 'operator', ADMIN: 'admin' };

// ========== MIDDLEWARE КЭШИРОВАНИЯ ==========
function cacheMiddleware(keyBuilder, ttl) {
    return async (req, res, next) => {
        try {
            const key = keyBuilder(req);
            const cachedData = await redisClient.get(key);
            if (cachedData) {
                return res.json({
                    source: 'cache',
                    data: JSON.parse(cachedData),
                    cachedAt: new Date().toISOString()
                });
            }
            req.cacheKey = key;
            req.cacheTTL = ttl;
            next();
        } catch (err) {
            console.error('Cache read error:', err);
            next();
        }
    };
}

async function saveToCache(key, data, ttl) {
    try {
        await redisClient.set(key, JSON.stringify(data), { EX: ttl });
    } catch (err) {
        console.error('Cache save error:', err);
    }
}

async function invalidateUsersCache(userId = null) {
    try {
        await redisClient.del('users:all');
        if (userId) {
            await redisClient.del(`users:${userId}`);
        }
    } catch (err) {
        console.error('Users cache invalidate error:', err);
    }
}

async function invalidateProductsCache(productId = null) {
    try {
        await redisClient.del('products:all');
        if (productId) {
            await redisClient.del(`products:${productId}`);
        }
    } catch (err) {
        console.error('Products cache invalidate error:', err);
    }
}

// ========== MIDDLEWARE АУТЕНТИФИКАЦИИ ==========
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Invalid token format' });
    }

    try {
        const payload = jwt.verify(token, ACCESS_SECRET);
        req.user = payload;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

const roleMiddleware = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        next();
    };
};

// ========== НАСТРОЙКА APP ==========
app.use(express.json());
app.use(cors({ origin: ['http://localhost', 'http://localhost:3002'], credentials: true }));

// ========== АУТЕНТИФИКАЦИЯ ==========
app.post('/api/auth/register', async (req, res) => {
    const { email, password, first_name, last_name } = req.body;

    if (!email || !password || !first_name || !last_name) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        // Проверка существования пользователя
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (email, first_name, last_name, password_hash, role) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id, email, first_name, last_name, role`,
            [email, first_name, last_name, passwordHash, ROLES.BUYER]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const result = await pool.query(
            'SELECT id, email, first_name, last_name, password_hash, role, is_active FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(401).json({ error: 'Account is blocked' });
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const accessToken = jwt.sign(
            { sub: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
            ACCESS_SECRET,
            { expiresIn: ACCESS_EXPIRES_IN }
        );

        const refreshToken = jwt.sign(
            { sub: user.id, email: user.email, role: user.role },
            REFRESH_SECRET,
            { expiresIn: REFRESH_EXPIRES_IN }
        );

        // Сохраняем refresh токен в БД
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await pool.query(
            'INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
            [refreshToken, user.id, expiresAt]
        );

        res.json({
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ error: 'refreshToken is required' });
    }

    try {
        const tokenResult = await pool.query(
            'SELECT user_id, is_valid FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
            [refreshToken]
        );

        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].is_valid) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        const payload = jwt.verify(refreshToken, REFRESH_SECRET);
        const userResult = await pool.query(
            'SELECT id, email, first_name, last_name, role FROM users WHERE id = $1 AND is_active = true',
            [payload.sub]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'User not found or blocked' });
        }

        const user = userResult.rows[0];

        // Инвалидируем старый refresh токен
        await pool.query('UPDATE refresh_tokens SET is_valid = false WHERE token = $1', [refreshToken]);

        const newAccessToken = jwt.sign(
            { sub: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
            ACCESS_SECRET,
            { expiresIn: ACCESS_EXPIRES_IN }
        );

        const newRefreshToken = jwt.sign(
            { sub: user.id, email: user.email, role: user.role },
            REFRESH_SECRET,
            { expiresIn: REFRESH_EXPIRES_IN }
        );

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await pool.query(
            'INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
            [newRefreshToken, user.id, expiresAt]
        );

        res.json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken
        });
    } catch (err) {
        console.error('Refresh error:', err);
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];

    try {
        await pool.query('UPDATE refresh_tokens SET is_valid = false WHERE token = $1', [token]);
        res.json({ message: 'Logged out successfully' });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, first_name, last_name, role FROM users WHERE id = $1 AND is_active = true',
            [req.user.sub]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Me error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (ТОЛЬКО АДМИН) ==========
app.get('/api/users', authMiddleware, roleMiddleware([ROLES.ADMIN]), cacheMiddleware(() => 'users:all', 60), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, first_name, last_name, role, is_active, created_at FROM users'
        );

        await saveToCache(req.cacheKey, result.rows, req.cacheTTL);
        res.json({ source: 'database', data: result.rows });
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/users/:id', authMiddleware, roleMiddleware([ROLES.ADMIN]), cacheMiddleware(req => `users:${req.params.id}`, 60), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, first_name, last_name, role, is_active, created_at FROM users WHERE id = $1',
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        await saveToCache(req.cacheKey, result.rows[0], req.cacheTTL);
        res.json({ source: 'database', data: result.rows[0] });
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/users/:id', authMiddleware, roleMiddleware([ROLES.ADMIN]), async (req, res) => {
    const { first_name, last_name, role } = req.body;

    try {
        const result = await pool.query(
            `UPDATE users SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name), role = COALESCE($3, role), updated_at = NOW()
             WHERE id = $4 RETURNING id, email, first_name, last_name, role, is_active`,
            [first_name, last_name, role, req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        await invalidateUsersCache(req.params.id);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/users/:id', authMiddleware, roleMiddleware([ROLES.ADMIN]), async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE users SET is_active = false WHERE id = $1 AND role != $2 RETURNING id',
            [req.params.id, ROLES.ADMIN]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found or cannot block admin' });
        }

        await invalidateUsersCache(req.params.id);
        res.status(204).send();
    } catch (err) {
        console.error('Block user error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== ТОВАРЫ ==========
app.get('/api/products', cacheMiddleware(() => 'products:all', 600), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, title, category, description, price, stock, image, created_at FROM products WHERE stock >= 0'
        );

        await saveToCache(req.cacheKey, result.rows, req.cacheTTL);
        res.json({ source: 'database', data: result.rows });
    } catch (err) {
        console.error('Get products error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/products/:id', cacheMiddleware(req => `products:${req.params.id}`, 600), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, title, category, description, price, stock, image, created_at FROM products WHERE id = $1',
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        await saveToCache(req.cacheKey, result.rows[0], req.cacheTTL);
        res.json({ source: 'database', data: result.rows[0] });
    } catch (err) {
        console.error('Get product error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/products', authMiddleware, roleMiddleware([ROLES.OPERATOR, ROLES.ADMIN]), async (req, res) => {
    const { title, category, description, price, stock, image } = req.body;

    if (!title || !category || !description || price === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO products (title, category, description, price, stock, image, owner_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [title.trim(), category.trim(), description.trim(), Number(price), Number(stock) || 0, image || '/images/default.jpg', req.user.sub]
        );

        await invalidateProductsCache();
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Create product error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/products/:id', authMiddleware, roleMiddleware([ROLES.OPERATOR, ROLES.ADMIN]), async (req, res) => {
    const { title, category, description, price, stock, image } = req.body;

    try {
        const productResult = await pool.query('SELECT owner_id FROM products WHERE id = $1', [req.params.id]);

        if (productResult.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        if (req.user.role !== ROLES.ADMIN && productResult.rows[0].owner_id !== req.user.sub) {
            return res.status(403).json({ error: 'You can only edit your own products' });
        }

        const result = await pool.query(
            `UPDATE products SET title = COALESCE($1, title), category = COALESCE($2, category), description = COALESCE($3, description),
             price = COALESCE($4, price), stock = COALESCE($5, stock), image = COALESCE($6, image), updated_at = NOW()
             WHERE id = $7 RETURNING *`,
            [title, category, description, price, stock, image, req.params.id]
        );

        await invalidateProductsCache(req.params.id);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Update product error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/products/:id', authMiddleware, roleMiddleware([ROLES.ADMIN]), async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        await invalidateProductsCache(req.params.id);
        res.status(204).send();
    } catch (err) {
        console.error('Delete product error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== ЗАПУСК ==========
async function startServer() {
    await initRedis();

    // Создание таблиц при запуске
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'buyer',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            category VARCHAR(100) NOT NULL,
            description TEXT,
            price INTEGER NOT NULL,
            stock INTEGER DEFAULT 0,
            image VARCHAR(500),
            owner_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id SERIAL PRIMARY KEY,
            token VARCHAR(500) NOT NULL,
            user_id INTEGER REFERENCES users(id),
            expires_at TIMESTAMP NOT NULL,
            is_valid BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    app.listen(PORT, () => {
        console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
        console.log(`📊 PostgreSQL подключена`);
        console.log(`⚡ Redis подключён для кэширования`);
    });
}

startServer().catch(console.error);