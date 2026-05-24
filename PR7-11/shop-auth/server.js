const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ========== VAPID КЛЮЧИ (ЗАМЕНИТЕ НА СВОИ ПОСЛЕ ГЕНЕРАЦИИ) ==========
const vapidKeys = {
    publicKey: 'ВАШ_ПУБЛИЧНЫЙ_VAPID_КЛЮЧ',
    privateKey: 'ВАШ_ПРИВАТНЫЙ_VAPID_КЛЮЧ'
};

webpush.setVapidDetails(
    'mailto:your-email@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// ========== НАСТРОЙКА APP ==========
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'frontend/build')));

// Прокси для API бэкенда (порт 3000)
app.use('/api', createProxyMiddleware({
    target: 'http://localhost:3000',
    changeOrigin: true
}));

// ========== HTTPS НАСТРОЙКА ==========
let server;
try {
    const sslOptions = {
        key: fs.readFileSync(path.join(__dirname, 'localhost+2-key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'localhost+2.pem'))
    };
    server = https.createServer(sslOptions, app);
    console.log('HTTPS сервер запущен');
} catch (err) {
    server = http.createServer(app);
    console.log('HTTP сервер запущен (push-уведомления не будут работать)');
}

// ========== WEBSOCKET ==========
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

let subscriptions = [];
let reminders = new Map();

io.on('connection', (socket) => {
    console.log('Клиент подключён:', socket.id);

    socket.on('productAdded', (product) => {
        io.emit('productAdded', product);
        sendPushNotification('Новый товар', `Добавлен: ${product.title}`, null);
    });

    socket.on('productUpdated', (product) => {
        io.emit('productUpdated', product);
        sendPushNotification('Обновление товара', `Обновлён: ${product.title}`, null);
    });

    socket.on('productDeleted', (productId) => {
        io.emit('productDeleted', productId);
        sendPushNotification('Удаление товара', `Товар ID: ${productId} удалён`, null);
    });

    socket.on('disconnect', () => {
        console.log('Клиент отключён:', socket.id);
    });
});

function sendPushNotification(title, body, reminderId) {
    const payload = JSON.stringify({ title, body, reminderId, url: '/' });
    
    subscriptions.forEach(sub => {
        webpush.sendNotification(sub, payload).catch(err => {
            console.error('Push ошибка:', err.message);
            subscriptions = subscriptions.filter(s => s !== sub);
        });
    });
}

app.post('/subscribe', (req, res) => {
    const subscription = req.body;
    if (!subscriptions.find(s => s.endpoint === subscription.endpoint)) {
        subscriptions.push(subscription);
    }
    console.log('Подписка добавлена, всего:', subscriptions.length);
    res.status(201).json({ message: 'Подписка сохранена' });
});

app.post('/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    subscriptions = subscriptions.filter(sub => sub.endpoint !== endpoint);
    console.log('Подписка удалена, осталось:', subscriptions.length);
    res.status(200).json({ message: 'Подписка удалена' });
});

// Откладывание напоминания
app.post('/snooze', (req, res) => {
    const reminderId = parseInt(req.query.reminderId);
    
    if (!reminderId || !reminders.has(reminderId)) {
        return res.status(400).json({ error: 'Reminder not found' });
    }
    
    const reminder = reminders.get(reminderId);
    clearTimeout(reminder.timeoutId);
    
    const newTimeoutId = setTimeout(() => {
        sendPushNotification('🔔 Напоминание отложено', reminder.text, reminderId);
        reminders.delete(reminderId);
    }, 5 * 60 * 1000);
    
    reminders.set(reminderId, {
        timeoutId: newTimeoutId,
        text: reminder.text,
        reminderTime: Date.now() + 5 * 60 * 1000
    });
    
    console.log(`Напоминание ${reminderId} отложено на 5 минут`);
    res.status(200).json({ message: 'Reminder snoozed for 5 minutes' });
});

// Обработка нового напоминания
io.on('connection', (socket) => {
    // ... существующий код ...
    
    socket.on('newReminder', (reminder) => {
        const { id, text, reminderTime } = reminder;
        const delay = reminderTime - Date.now();
        
        if (delay <= 0) return;
        
        console.log(`Напоминание "${text}" через ${Math.round(delay / 60000)} мин`);
        
        const timeoutId = setTimeout(() => {
            sendPushNotification('🔔 Напоминание', text, id);
            reminders.delete(id);
        }, delay);
        
        reminders.set(id, { timeoutId, text, reminderTime });
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на http${server instanceof https.Server ? 's' : ''}://localhost:${PORT}`);
});