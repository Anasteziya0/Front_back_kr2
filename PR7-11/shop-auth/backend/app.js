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

// Роли
const ROLES = {
    BUYER: 'buyer',
    OPERATOR: 'operator',
    ADMIN: 'admin'
};

// Пути к файлам
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PASSWORDS_DIR = path.join(DATA_DIR, 'passwords');

// Создаём папки
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PASSWORDS_DIR)) fs.mkdirSync(PASSWORDS_DIR, { recursive: true });

// Загрузка пользователей
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (err) {}
    
    return [];
}

// Сохранение пользователей
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Получение хеша пароля
function getPasswordHash(userId) {
    const file = path.join(PASSWORDS_DIR, `${userId}.hash`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

// Сохранение хеша пароля
function savePasswordHash(userId, hash) {
    fs.writeFileSync(path.join(PASSWORDS_DIR, `${userId}.hash`), hash, 'utf8');
}

let users = loadUsers();

// Если нет пользователей, создаём администратора
if (users.length === 0) {
    const adminId = nanoid(8);
    const adminPasswordHash = bcrypt.hashSync('admin123', 10);
    
    users.push({
        id: adminId,
        email: 'admin@shop.com',
        first_name: 'Admin',
        last_name: 'System',
        role: ROLES.ADMIN,
        isActive: true,
        createdAt: new Date().toISOString()
    });
    
    saveUsers(users);
    savePasswordHash(adminId, adminPasswordHash);
    
    console.log('✅ Администратор создан: admin@shop.com / admin123');
}

// Товары (в памяти для простоты)
let products = [
    { id: nanoid(8), title: "Акварель Белые ночи 24 цвета", category: "Краски", description: "Профессиональная акварель", price: 2450, stock: 15, image: "/images/akvarel.webp" },
    { id: nanoid(8), title: "Кисть синтетика круглая №2", category: "Кисти", description: "Синтетическая кисть", price: 180, stock: 50, image: "/images/brushes.jpg" },
    { id: nanoid(8), title: "Холст на подрамнике 30x40 см", category: "Холсты", description: "Льняной холст", price: 890, stock: 8, image: "/images/canvas.webp" }
];

// Middleware
app.use(express.json());
app.use(cors({ origin: 'http://localhost:3002', credentials: true }));

// Генерация токенов
const generateAccessToken = (user) => {
    return jwt.sign(
        { sub: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
        ACCESS_SECRET,
        { expiresIn: '15m' }
    );
};

const generateRefreshToken = (user) => {
    return jwt.sign(
        { sub: user.id, email: user.email, role: user.role },
        REFRESH_SECRET,
        { expiresIn: '7d' }
    );
};

// Middleware проверки токена
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

// ========== АУТЕНТИФИКАЦИЯ ==========
app.post('/api/auth/register', async (req, res) => {
    const { email, password, first_name, last_name } = req.body;
    
    if (!email || !password || !first_name || !last_name) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (users.find(u => u.email === email)) {
        return res.status(409).json({ error: 'Email already exists' });
    }
    
    const newUser = {
        id: nanoid(8),
        email,
        first_name,
        last_name,
        role: ROLES.BUYER,
        isActive: true,
        createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    saveUsers(users);
    
    const passwordHash = await bcrypt.hash(password, 10);
    savePasswordHash(newUser.id, passwordHash);
    
    res.status(201).json({
        id: newUser.id,
        email: newUser.email,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        role: newUser.role
    });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const user = users.find(u => u.email === email);
    if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const passwordHash = getPasswordHash(user.id);
    if (!passwordHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValid = await bcrypt.compare(password, passwordHash);
    if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    
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
});

app.post('/api/auth/refresh', (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(400).json({ error: 'refreshToken is required' });
    }
    
    try {
        const payload = jwt.verify(refreshToken, REFRESH_SECRET);
        const user = users.find(u => u.id === payload.sub);
        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        const newAccessToken = generateAccessToken(user);
        const newRefreshToken = generateRefreshToken(user);
        
        res.json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken
        });
    } catch (err) {
        return res.status(401).json({ error: 'Invalid refresh token' });
    }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role
    });
});

// ========== ПОЛЬЗОВАТЕЛИ (только админ) ==========
app.get('/api/users', authMiddleware, roleMiddleware([ROLES.ADMIN]), (req, res) => {
    res.json(users.map(u => ({
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        role: u.role,
        isActive: u.isActive
    })));
});

// ========== ТОВАРЫ ==========
app.get('/api/products', (req, res) => {
    res.json(products);
});

app.post('/api/products', authMiddleware, roleMiddleware([ROLES.OPERATOR, ROLES.ADMIN]), (req, res) => {
    const { title, category, description, price, stock, image } = req.body;
    if (!title || !category || !description || price === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const newProduct = {
        id: nanoid(8),
        title: title.trim(),
        category: category.trim(),
        description: description.trim(),
        price: Number(price),
        stock: Number(stock) || 0,
        image: image || '/images/default.jpg',
        ownerId: req.user.sub,
        createdAt: new Date().toISOString()
    };
    products.push(newProduct);
    res.status(201).json(newProduct);
});

app.put('/api/products/:id', authMiddleware, roleMiddleware([ROLES.OPERATOR, ROLES.ADMIN]), (req, res) => {
    const index = products.findIndex(p => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Product not found' });
    
    const { title, category, description, price, stock, image } = req.body;
    products[index] = {
        ...products[index],
        title: title.trim(),
        category: category.trim(),
        description: description.trim(),
        price: Number(price),
        stock: Number(stock) || products[index].stock,
        image: image || products[index].image,
        updatedAt: new Date().toISOString()
    };
    res.json(products[index]);
});

app.delete('/api/products/:id', authMiddleware, roleMiddleware([ROLES.ADMIN]), (req, res) => {
    products = products.filter(p => p.id !== req.params.id);
    res.status(204).send();
});

// Запуск
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`👥 Администратор: admin@shop.com / admin123`);
});