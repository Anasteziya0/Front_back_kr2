const { Pool } = require('pg');
require('dotenv').config();

// Настройки подключения к PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'users_db',
    max: 20, // максимальное количество клиентов в пуле
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Проверка подключения
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
    } else {
        console.log('✅ PostgreSQL подключена успешно');
        release();
    }
});

module.exports = pool;