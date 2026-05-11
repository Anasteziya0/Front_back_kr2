const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Секреты
const ACCESS_SECRET = 'my_super_secret_access_key_2024';
const REFRESH_SECRET = 'my_super_secret_refresh_key_2024';
const ACCESS_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_IN = '7d';

// Роли
const ROLES = { BUYER: 'buyer', OPERATOR: 'operator', ADMIN: 'admin' };

// Пути
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const PASSWORDS_DIR = path.join(DATA_DIR, 'passwords');
const TOKENS_DIR = path.join(DATA_DIR, 'tokens');
const ACCESS_TOKENS_FILE = path.join(TOKENS_DIR, 'access_tokens.json');
const REFRESH_TOKENS_FILE = path.join(TOKENS_DIR, 'refresh_tokens.json');

// Создаем папки
[ DATA_DIR, PASSWORDS_DIR, TOKENS_DIR ].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ========== ФУНКЦИИ ==========
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (err) {}
    
    const defaultUsers = [
        { id: nanoid(8), email: 'admin@shop.com', first_name: 'Admin', last_name: 'System', role: ROLES.ADMIN, isActive: true, createdAt: new Date().toISOString() },
        { id: nanoid(8), email: 'operator@shop.com', first_name: 'Оператор', last_name: 'Магазина', role: ROLES.OPERATOR, isActive: true, createdAt: new Date().toISOString() },
        { id: nanoid(8), email: 'buyer@shop.com', first_name: 'Покупатель', last_name: 'Тестовый', role: ROLES.BUYER, isActive: true, createdAt: new Date().toISOString() }
    ];
    saveUsers(defaultUsers);
    return defaultUsers;
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function savePasswordHash(userId, hash) {
    fs.writeFileSync(path.join(PASSWORDS_DIR, `${userId}.hash`), hash, 'utf8');
}

function getPasswordHash(userId) {
    const file = path.join(PASSWORDS_DIR, `${userId}.hash`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function loadProducts() {
    try {
        if (fs.existsSync(PRODUCTS_FILE)) {
            return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
        }
    } catch (err) {}
    
    const defaultProducts = [
        { id: nanoid(8), title: "Акварель Белые ночи 24 цвета", category: "Краски", description: "Профессиональная акварель, 24 цвета по 2.5 мл", price: 2450, stock: 15, image: "/images/akvarel.webp", ownerId: "admin", createdAt: new Date().toISOString() },
        { id: nanoid(8), title: "Кисть синтетика круглая №2", category: "Кисти", description: "Синтетическая кисть, круглая форма, отличная упругость", price: 180, stock: 50, image: "/images/brushes.jpg", ownerId: "admin", createdAt: new Date().toISOString() },
        { id: nanoid(8), title: "Холст на подрамнике 30x40 см", category: "Холсты", description: "Льняной холст, среднезернистый, грунтованный", price: 890, stock: 8, image: "/images/canvas.webp", ownerId: "admin", createdAt: new Date().toISOString() },
        { id: nanoid(8), title: "Масляные краски Набор 12 цветов", category: "Краски", description: "Художественное масло, 12 цветов по 18 мл", price: 3200, stock: 7, image: "/images/oil.jpg", ownerId: "admin", createdAt: new Date().toISOString() },
        { id: nanoid(8), title: "Бумага для акварели А4", category: "Бумага", description: "Хлопковая бумага, 100% хлопок, 20 листов", price: 450, stock: 25, image: "/images/paper.jpg", ownerId: "admin", createdAt: new Date().toISOString() },
        { id: nanoid(8), title: "Набор карандашей графитных 12 шт", category: "Рисование", description: "Профессиональные графитные карандаши разной твердости", price: 650, stock: 20, image: "/images/pencils.webp", ownerId: "admin", createdAt: new Date().toISOString() },
        { id: nanoid(8), title: "Пастель масляная 24 цвета", category: "Пастель", description: "Масляная пастель, мягкая, яркие цвета", price: 1200, stock: 12, image: "/images/pastel.jpg", ownerId: "admin", createdAt: new Date().toISOString() },
        { id: nanoid(8), title: "Мольберт треножник", category: "Мольберты", description: "Деревянный мольберт, регулировка высоты", price: 4500, stock: 3, image: "/images/easel.jpg", ownerId: "admin", createdAt: new Date().toISOString() },
        { id: nanoid(8), title: "Палитра пластиковая", category: "Аксессуары", description: "Пластиковая палитра для смешивания красок", price: 150, stock: 30, image: "/images/palette.jpg", ownerId: "admin", createdAt: new Date().toISOString() },
        { id: nanoid(8), title: "Скетчбук А5 100 листов", category: "Бумага", description: "Скетчбук для набросков, плотная бумага", price: 350, stock: 25, image: "/images/sketchbook.jpg", ownerId: "admin", createdAt: new Date().toISOString() }
    ];
    saveProducts(defaultProducts);
    return defaultProducts;
}

function saveProducts(products) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf8');
}

function loadAccessTokens() {
    try {
        if (fs.existsSync(ACCESS_TOKENS_FILE)) return JSON.parse(fs.readFileSync(ACCESS_TOKENS_FILE, 'utf8'));
    } catch (err) {}
    return {};
}

function saveAccessTokens(tokens) {
    fs.writeFileSync(ACCESS_TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
}

function loadRefreshTokens() {
    try {
        if (fs.existsSync(REFRESH_TOKENS_FILE)) return JSON.parse(fs.readFileSync(REFRESH_TOKENS_FILE, 'utf8'));
    } catch (err) {}
    return {};
}

function saveRefreshTokens(tokens) {
    fs.writeFileSync(REFRESH_TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
}

let users = loadUsers();
let products = loadProducts();

// ========== ХЕШИРОВАНИЕ ==========
const hashPassword = async (password) => bcrypt.hash(password, 10);
const verifyPassword = async (password, hash) => bcrypt.compare(password, hash);

// ========== ГЕНЕРАЦИЯ ТОКЕНОВ ==========
const generateAccessToken = (user) => {
    return jwt.sign(
        { sub: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
        ACCESS_SECRET,
        { expiresIn: ACCESS_EXPIRES_IN }
    );
};

const generateRefreshToken = (user) => {
    return jwt.sign(
        { sub: user.id, email: user.email, role: user.role },
        REFRESH_SECRET,
        { expiresIn: REFRESH_EXPIRES_IN }
    );
};

// ========== MIDDLEWARE ==========
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Invalid token format' });
    
    try {
        const payload = jwt.verify(token, ACCESS_SECRET);
        req.user = payload;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
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

// Middleware
app.use(express.json());
app.use(cors({ origin: 'http://localhost:3001' }));

// ========== СБРОС ПАРОЛЕЙ ПРИ ЗАПУСКЕ ==========
(async function resetPasswords() {
    console.log('🔄 Установка паролей...');
    for (const user of users) {
        const hash = await bcrypt.hash('admin123', 10);
        savePasswordHash(user.id, hash);
        console.log(`✅ ${user.email} → пароль: admin123 (роль: ${user.role})`);
    }
    console.log('🎉 Все пароли установлены!');
})();

// ========== АУТЕНТИФИКАЦИЯ ==========
app.post('/api/auth/register', async (req, res) => {
    const { email, password, first_name, last_name } = req.body;
    if (!email || !password || !first_name || !last_name) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password min 6 characters' });
    if (users.find(u => u.email === email)) return res.status(409).json({ error: 'Email exists' });
    
    const newUser = { id: nanoid(8), email, first_name, last_name, role: ROLES.BUYER, isActive: true, createdAt: new Date().toISOString() };
    users.push(newUser);
    saveUsers(users);
    
    const hash = await bcrypt.hash(password, 10);
    savePasswordHash(newUser.id, hash);
    
    res.status(201).json({ id: newUser.id, email, first_name, last_name, role: newUser.role });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const user = users.find(u => u.email === email);
    if (!user || !user.isActive) return res.status(401).json({ error: 'Invalid credentials' });
    
    const hash = getPasswordHash(user.id);
    if (!hash || !(await bcrypt.compare(password, hash))) return res.status(401).json({ error: 'Invalid credentials' });
    
    res.json({
        accessToken: generateAccessToken(user),
        refreshToken: generateRefreshToken(user),
        user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role }
    });
});

app.post('/api/auth/refresh', (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
    
    try {
        const payload = jwt.verify(refreshToken, REFRESH_SECRET);
        const user = users.find(u => u.id === payload.sub);
        if (!user || !user.isActive) return res.status(401).json({ error: 'User not found' });
        
        res.json({ accessToken: generateAccessToken(user), refreshToken: generateRefreshToken(user) });
    } catch (err) {
        return res.status(401).json({ error: 'Invalid refresh token' });
    }
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
    res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role });
});

// ========== ПОЛЬЗОВАТЕЛИ (только ADMIN) ==========
app.get('/api/users', authMiddleware, roleMiddleware([ROLES.ADMIN]), (req, res) => {
    res.json(users.map(u => ({ id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, role: u.role, isActive: u.isActive })));
});

app.put('/api/users/:id', authMiddleware, roleMiddleware([ROLES.ADMIN]), (req, res) => {
    const index = users.findIndex(u => u.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'User not found' });
    
    const { first_name, last_name, role } = req.body;
    if (first_name) users[index].first_name = first_name;
    if (last_name) users[index].last_name = last_name;
    if (role && Object.values(ROLES).includes(role)) users[index].role = role;
    saveUsers(users);
    res.json(users[index]);
});

app.delete('/api/users/:id', authMiddleware, roleMiddleware([ROLES.ADMIN]), (req, res) => {
    const index = users.findIndex(u => u.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'User not found' });
    if (users[index].role === ROLES.ADMIN) return res.status(403).json({ error: 'Cannot block admin' });
    
    users[index].isActive = false;
    saveUsers(users);
    res.status(204).send();
});

// ========== ТОВАРЫ ==========
app.get('/api/products', (req, res) => res.json(products));
app.get('/api/products/:id', (req, res) => {
    const product = products.find(p => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
});

app.post('/api/products', authMiddleware, roleMiddleware([ROLES.OPERATOR, ROLES.ADMIN]), (req, res) => {
    const { title, category, description, price, stock, image } = req.body;
    if (!title || !category || !description || !price) return res.status(400).json({ error: 'Missing fields' });
    
    const newProduct = { id: nanoid(8), title, category, description, price: Number(price), stock: Number(stock) || 0, image: image || '/images/default.jpg', ownerId: req.user.sub, createdAt: new Date().toISOString() };
    products.push(newProduct);
    saveProducts(products);
    res.status(201).json(newProduct);
});

app.put('/api/products/:id', authMiddleware, roleMiddleware([ROLES.OPERATOR, ROLES.ADMIN]), (req, res) => {
    const index = products.findIndex(p => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Product not found' });
    
    const { title, category, description, price, stock, image } = req.body;
    products[index] = { ...products[index], title, category, description, price: Number(price), stock: Number(stock) || products[index].stock, image: image || products[index].image, updatedAt: new Date().toISOString() };
    saveProducts(products);
    res.json(products[index]);
});

app.delete('/api/products/:id', authMiddleware, roleMiddleware([ROLES.ADMIN]), (req, res) => {
    products = products.filter(p => p.id !== req.params.id);
    saveProducts(products);
    res.status(204).send();
});

// Swagger
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const swaggerOptions = {
    definition: { openapi: '3.0.0', info: { title: 'API Магазина', version: '1.0.0' }, servers: [{ url: `http://localhost:${PORT}` }] },
    apis: ['./app.js']
};
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerJsdoc(swaggerOptions)));

// Запуск
app.listen(PORT, () => {
    console.log(`🚀 Сервер на http://localhost:${PORT}`);
    console.log(`📚 Swagger: http://localhost:${PORT}/api-docs`);
});