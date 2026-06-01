const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
    console.log('Клиент подключён:', socket.id);

    socket.on('newTask', (task) => {
        console.log('Новая задача:', task.text);
        io.emit('taskAdded', task);
    });

    socket.on('disconnect', () => {
        console.log('Клиент отключён:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`WebSocket сервер запущен на порту ${PORT}`);
});