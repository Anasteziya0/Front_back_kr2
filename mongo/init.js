// Создание коллекции и индексов
db = db.getSiblingDB('users_db');

// Создаём коллекцию users
db.createCollection('users');

// Создаём индексы для оптимизации
db.users.createIndex({ first_name: 1 });
db.users.createIndex({ last_name: 1 });
db.users.createIndex({ created_at: -1 });

// Вставляем тестовые данные
db.users.insertMany([
    { first_name: 'Иван', last_name: 'Петров', age: 25, created_at: new Date(), updated_at: new Date() },
    { first_name: 'Мария', last_name: 'Сидорова', age: 30, created_at: new Date(), updated_at: new Date() },
    { first_name: 'Петр', last_name: 'Иванов', age: 28, created_at: new Date(), updated_at: new Date() }
]);

print('MongoDB initialized with users collection');