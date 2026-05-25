# Практические занятия 7-12 — Фронтенд и бэкенд разработка

## Стек технологий

- **Бэкенд**: Node.js, Express.js
- **Фронтенд**: React.js
- **Аутентификация**: bcrypt, JWT (access + refresh токены)
- **Документация API**: Swagger UI

---

## Практика 7 — Базовая аутентификация (bcrypt)


### Что сделано:
Реализован сервер на Node.js с использованием фреймворка Express. Для хранения данных
использованы массивы в памяти (in-memory). Пароли пользователей не хранятся в открытом виде —
перед сохранением они хешируются с помощью алгоритма **bcrypt** с параметром cost = 10,
который автоматически добавляет случайную соль к каждому паролю. При входе введённый пароль
снова хешируется и сравнивается с хранимым хешем через `bcrypt.compare()`.
Реализован полный CRUD для товаров. Подключена документация Swagger UI через библиотеки
`swagger-jsdoc` и `swagger-ui-express` — все маршруты описаны JSDoc-комментариями прямо в коде.

| Маршрут | Метод | Описание |
|---|---|---|
| /api/auth/register | POST | Регистрация пользователя |
| /api/auth/login | POST | Вход в систему |
| /api/products | POST | Создать товар |
| /api/products | GET | Получить список товаров |
| /api/products/:id | GET | Получить товар по id |
| /api/products/:id | PUT | Обновить параметры товара |
| /api/products/:id | DELETE | Удалить товар |

**Что сделано:**
- Хеширование паролей с помощью bcrypt (10 раундов)
- Поля пользователя: id, email, first_name, last_name, password
- Поля товара: id, title, category, description, price
- Документация API через Swagger UI (`/api-docs`)

### Как реализовано:
```js
// Хеширование пароля при регистрации
async function hashPassword(password) {
    return bcrypt.hash(password, 10); // 10 rounds
}

// Проверка пароля при входе
async function verifyPassword(password, passwordHash) {
    return bcrypt.compare(password, passwordHash);
}
```

---

## Практика 8 — JWT токены и защищённые маршруты


### Что сделано
После успешного входа сервер генерирует **JWT access-токен** и возвращает его клиенту.
Токен подписывается секретным ключом (`ACCESS_SECRET`) и содержит в полезной нагрузке
id пользователя, email и имя. Время жизни токена — **15 минут**.

Создан middleware `authMiddleware`, который при каждом защищённом запросе извлекает токен
из заголовка `Authorization: Bearer <token>`, верифицирует его через `jwt.verify()` и
кладёт расшифрованную полезную нагрузку в `req.user`. Если токен отсутствует или истёк —
возвращается ошибка 401.

Добавлен защищённый маршрут `/api/auth/me`, который по токену находит пользователя в
массиве и возвращает его данные без пароля.

**Что сделано:**
- Выдача JWT access-токена при входе в систему
- Middleware `authMiddleware` для проверки токена в заголовке `Authorization: Bearer`
- Защищённый маршрут `GET /api/auth/me` — возвращает текущего авторизованного пользователя
- Защита маршрутов: `GET /api/products/:id`, `PUT /api/products/:id`, `DELETE /api/products/:id`

### Как реализовано:
```js
// Создание токена при входе
const accessToken = jwt.sign(
    { sub: user.id, email: user.email, first_name: user.first_name },
    ACCESS_SECRET,
    { expiresIn: '15m' }
);

// Middleware проверки токена
function authMiddleware(req, res, next) {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token)
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    try {
        req.user = jwt.verify(token, ACCESS_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}
```

---

## Практика 9 — Refresh-токены


### Что сделано:
Решена проблема короткого времени жизни access-токена. При входе сервер теперь выдаёт
**два токена**: access (15 минут) и refresh (7 дней). Refresh-токен подписывается отдельным
секретом (`REFRESH_SECRET`) и хранится на сервере в `Set` для валидации.

Реализована **ротация токенов**: при запросе на `/api/auth/refresh` старый refresh-токен
удаляется из хранилища, а клиенту выдаётся новая пара токенов. Это защищает от повторного
использования украденного refresh-токена.

**Что сделано:**
- Генерация пары токенов: access (15 минут) и refresh (7 дней)
- Хранилище refresh-токенов в памяти (`Set`)
- Маршрут `POST /api/auth/refresh` — принимает refresh-токен, возвращает новую пару
- Ротация refresh-токенов: старый удаляется, выдаётся новый

### Как реализовано:
```js
// Хранилище refresh-токенов
const refreshTokens = new Set();

// Ротация при обновлении
app.post('/api/auth/refresh', (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshTokens.has(refreshToken))
        return res.status(401).json({ error: 'Invalid refresh token' });

    const payload = jwt.verify(refreshToken, REFRESH_SECRET);
    refreshTokens.delete(refreshToken);           // удаляем старый

    const newAccess = generateAccessToken(user);
    const newRefresh = generateRefreshToken(user);
    refreshTokens.add(newRefresh);                // сохраняем новый

    res.json({ accessToken: newAccess, refreshToken: newRefresh });
});
```

---

## Практика 10 — Фронтенд на React.js


### Что сделано:
Реализован фронтенд на **React.js**. Роутинг организован через `react-router-dom` v6.
HTTP-запросы выполняются через **axios** с настроенными interceptors.

**Request interceptor** автоматически добавляет access-токен из `localStorage` в заголовок
`Authorization` каждого запроса — чтобы не прописывать это вручную в каждом вызове.

**Response interceptor** перехватывает ответы с кодом 401. Если токены есть в хранилище,
он автоматически отправляет запрос на `/api/auth/refresh`, получает новую пару токенов,
сохраняет их и повторяет исходный запрос с новым access-токеном — пользователь не замечает
ничего.

Глобальное состояние пользователя хранится в `AuthContext` через `useContext` + `useState`.
При загрузке приложения, если в `localStorage` есть токен, автоматически запрашивается
`/api/auth/me` для восстановления сессии.

Защищённые страницы обёрнуты в компонент `ProtectedRoute`, который перенаправляет
неавторизованных пользователей на `/login`.

**Что сделано:**
- Реализован фронтенд на React.js (Create React App)
- Axios-клиент с interceptors для автоматической подстановки access-токена
- Автоматическое обновление токена при получении ошибки 401
- Страницы приложения:
  - `/login` — вход в систему
  - `/register` — регистрация
  - `/` — список товаров с поиском
  - `/products/:id` — детальная страница товара
  - `/me` — профиль пользователя
- Токены хранятся в `localStorage`

### Как реализовано:
```js
// Request interceptor — подставляем токен
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// Response interceptor — автообновление токена при 401
apiClient.interceptors.response.use(
    response => response,
    async (error) => {
        if (error.response?.status === 401 && !error.config._retry) {
            error.config._retry = true;
            const { data } = await axios.post('/api/auth/refresh', {
                refreshToken: localStorage.getItem('refreshToken')
            });
            localStorage.setItem('accessToken', data.accessToken);
            localStorage.setItem('refreshToken', data.refreshToken);
            return apiClient(error.config); // повторяем запрос
        }
        return Promise.reject(error);
    }
);
```

---

## Практика 11 — RBAC (система ролей)


### Что сделано:
Реализована модель управления доступом на основе ролей (**RBAC**). В системе три роли:
`user`, `seller`, `admin`. Роль сохраняется в базе при регистрации и включается в payload JWT-токена,
что позволяет проверять её без дополнительных запросов к БД.

Создан middleware `roleMiddleware(allowedRoles)`, который принимает массив допустимых ролей
и проверяет роль текущего пользователя из `req.user`. Если роль не подходит — возвращается 403 Forbidden.

Добавлена возможность **блокировки пользователей** администратором: вместо удаления
устанавливается флаг `blocked: true`. Заблокированный пользователь не может войти в систему.

На фронтенде кнопки создания, редактирования и удаления отображаются только тем ролям,
у которых есть соответствующие права. Администратору доступна страница `/users` для
управления пользователями: смена роли и блокировка.

**Что сделано:**
- Добавлена система ролей: `user`, `seller`, `admin`
- Middleware `roleMiddleware` для ограничения доступа по роли
- Права доступа:

| Маршрут | Метод | Роль |
|---|---|---|
| /api/auth/register, /login, /refresh | POST | Гость |
| /api/auth/me | GET | user, seller, admin |
| /api/products (список) | GET | user, seller, admin |
| /api/products/:id (просмотр) | GET | user, seller, admin |
| /api/products (создание) | POST | seller, admin |
| /api/products/:id (обновление) | PUT | seller, admin |
| /api/products/:id (удаление) | DELETE | admin |
| /api/users/* | GET/PUT/DELETE | admin |

- Маршрут `GET /api/users` — список пользователей (только admin)
- Маршрут `PUT /api/users/:id` — изменение роли пользователя (только admin)
- Маршрут `DELETE /api/users/:id` — блокировка пользователя (только admin)
- На фронтенде кнопки показываются/скрываются в зависимости от роли
- Страница `/users` доступна только администратору

### Как реализовано:
```js
// Role middleware
function roleMiddleware(allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role))
            return res.status(403).json({ error: 'Forbidden' });
        next();
    };
}

// Применение — только продавец и админ могут создавать товары
app.post('/api/products',
    authMiddleware,
    roleMiddleware(['seller', 'admin']),
    (req, res) => { ... }
);

// На фронтенде — показываем кнопки по роли
const canEdit = user?.role === 'seller' || user?.role === 'admin';
const canDelete = user?.role === 'admin';
```

---

## Запуск проекта

### Бэкенд
```bash
npm install
node server.js
```
Сервер запустится на `http://localhost:3000`  
Swagger UI: `http://localhost:3000/api-docs`

### Фронтенд
```bash
cd client
npm install
npm start
```
Приложение запустится на `http://localhost:3001`
