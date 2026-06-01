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








# Практические работы №13–17: Frontend & Backend разработка


---

## Практическое занятие №13 – Service Worker (Базовый офлайн)

**Цель:** Создать основу для офлайн-работы с помощью Service Worker.

**Результат:** Приложение полностью работает без интернета после первого визита.

---

## Практическое занятие №14 – Web App Manifest (PWA установка)

**Цель:** Добавить манифест для установки приложения на устройство.

**Реализовано:**
- Создан файл `manifest.json` с полями: `name`, `short_name`, `theme_color`, `background_color`, `icons` (5+ размеров).
- Подготовлены иконки разных размеров (16x16 – 512x512) с `purpose: maskable`.
- Добавлены мета-теги для iOS (`apple-touch-icon`, `apple-mobile-web-app-status-bar-style`).
- Обновлён Service Worker для кэширования иконок и манифеста.
- Протестирована установка через браузер (Chrome, Edge).

**Результат:** Приложение можно установить как нативное, оно запускается в отдельном окне без адресной строки.

---

## Практическое занятие №15 – HTTPS + App Shell (Мгновенная загрузка)

**Цель:** Обеспечить безопасное соединение и архитектуру «каркас приложения».

**Реализовано:**
- Настроен локальный HTTPS с помощью утилиты `mkcert`.
- Архитектура App Shell:
  - `index.html` содержит только шапку и контейнер.
  - Контент страниц (`home.html`, `about.html`) подгружается динамически через `fetch`.
- Стратегия кэширования:
  - Статика (App Shell) – Cache First.
  - Динамические страницы (`/content/`) – Network First (с фолбеком на кэш).
- Навигация без перезагрузки страницы (SPA-подход).

**Результат:** Интерфейс отображается мгновенно даже на медленном соединении. Есть страница «О приложении».

---

## Практическое занятие №16 – WebSocket + Push (Реальное время + уведомления)

**Цель:** Синхронизация заметок между клиентами в реальном времени и базовые push-уведомления.

**Реализовано:**
- Установлены зависимости: `express`, `socket.io`, `web-push`, `cors`, `body-parser`.
- Генерация VAPID-ключей для push-уведомлений.
- Серверная часть (`server.js`):
  - WebSocket-сервер на `socket.io`.
  - Эндпоинты `/subscribe`, `/unsubscribe` для хранения подписок.
  - Рассылка события `taskAdded` всем клиентам.
- Клиентская часть:
  - Подключение к WebSocket.
  - Отправка `newTask` при добавлении заметки.
  - Всплывающее сообщение при получении `taskAdded`.
  - Подписка/отписка на push через `PushManager`.
  - Обработка push-уведомлений в Service Worker (`sw.js`).

**Результат:** Добавленная заметка видна на всех вкладках. Push-уведомления приходят даже при закрытом приложении.

---

## Запуск проекта

1. Клонировать репозиторий.
2. Установить зависимости: `npm install`
3. Сгенерировать VAPID-ключи и вставить в `server.js`.
4. Сгенерировать SSL-сертификаты: `mkcert localhost 127.0.0.1 ::1`
5. Запустить сервер: `npm start`
6. Открыть `https://localhost:3001`

---







# KR4 — TechStore: базы данных, кэш, балансировка, контейнеры

KR4 — это продолжение TechStore из KR2. Если в KR2 все данные хранились в памяти (массивы), то здесь каждая практика добавляет новый уровень инфраструктуры: реальные базы данных, кэш, балансировку нагрузки и контейнеризацию.

Все практики используют одно и то же приложение — интернет-магазин TechStore с теми же товарами, пользователями и правами доступа (user / seller / admin).

---

## Как связаны практики

```
KR2 (в памяти)
    │
    ├── Practice 19 ── PostgreSQL (реляционная БД)
    ├── Practice 20 ── MongoDB (документная БД)
    ├── Practice 21 ── KR2 + Redis (кэширование запросов)
    ├── Practice 22 ── Nginx (балансировка между серверами)
    └── Practice 23 ── Docker Compose (разбивка на микросервисы)
```

---

## Practice 19 — PostgreSQL

**Порт:** `3000` | **База данных:** PostgreSQL (локальная, Homebrew)

### Что это

KR2 хранил пользователей и товары в массивах — при перезапуске всё терялось. Practice 19 заменяет массивы на PostgreSQL: данные сохраняются в реальных таблицах и не исчезают после остановки сервера.

### Как запустить

```bash
cd KR4/Practice-19
npm install
node server.js
# База данных kr4_p19 и таблицы создаются автоматически
```

### Что внутри

- Две таблицы: `users` и `products`
- ORM Sequelize — работа с БД через JavaScript-объекты вместо SQL
- При первом запуске автоматически создаётся БД и добавляются 5 стартовых товаров
- Полная авторизация: регистрация, JWT-токены, роли (user / seller / admin)

### API

```
POST /api/auth/register   — регистрация
POST /api/auth/login      — вход, получить токен
POST /api/auth/refresh    — обновить токен
GET  /api/auth/me         — текущий пользователь

GET    /api/products      — список товаров (все роли)
GET    /api/products/:id  — товар по ID
POST   /api/products      — добавить товар (seller, admin)
PUT    /api/products/:id  — изменить товар (seller, admin)
DELETE /api/products/:id  — удалить товар (admin)

GET    /api/users         — список пользователей (admin)
PUT    /api/users/:id     — изменить пользователя (admin)
DELETE /api/users/:id     — заблокировать (admin)
```

### Пример

```bash
# Регистрация
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","first_name":"Иван","last_name":"Петров","password":"pass123","role":"admin"}'

# Вход
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"pass123"}'
# → { "accessToken": "...", "refreshToken": "..." }

# Получить товары
curl http://localhost:3000/api/products \
  -H "Authorization: Bearer <accessToken>"
```

---

## Practice 20 — MongoDB

**Порт:** `3001` | **База данных:** MongoDB (Docker)

### Что это

То же приложение TechStore, но вместо PostgreSQL — MongoDB. Разница в подходе к хранению: PostgreSQL требует заранее описанную схему (таблицы, столбцы, типы), MongoDB хранит документы в виде JSON и позволяет менять структуру на ходу.

### Как запустить

```bash
# 1. Запустить MongoDB
docker run -d --name mongo-kr4 -p 27017:27017 mongo:7

# 2. Запустить сервер
cd KR4/Practice-20
npm install
node server.js
```

### Чем отличается от Practice 19

| | Practice 19 (PostgreSQL) | Practice 20 (MongoDB) |
|--|---|---|
| Тип данных | Таблицы со строгой схемой | Документы (JSON) |
| ID | Число: `1, 2, 3` | Строка: `6a0a339a...` |
| ORM / ODM | Sequelize | Mongoose |
| Запросы | SQL под капотом | MongoDB API |
| Гибкость схемы | Низкая | Высокая |

### API — идентично Practice 19

Те же маршруты `/api/auth/*`, `/api/products`, `/api/users` — только данные хранятся в MongoDB.

---

## Practice 21 — Redis кэширование

**Порт:** `3002` | **Кэш:** Redis (Docker)

### Что это

Расширение KR2 Practice 11-12: добавляет слой кэширования через Redis. При частых одинаковых запросах (например, список товаров открывают 1000 раз в минуту) сервер не идёт в базу каждый раз, а отдаёт сохранённый ответ из Redis.

### Как запустить

```bash
# 1. Запустить Redis
docker run -d --name redis-kr4 -p 6379:6379 redis:alpine

# 2. Запустить сервер
cd KR4/Practice-21
npm install
node server.js
```

### Как работает кэш

```
1-й запрос GET /api/products:
  → Redis: нет данных (cache miss)
  → Сервер считает данные
  → Сохранить в Redis на 10 минут
  → Ответ: { "source": "server", "data": [...] }

2-й запрос GET /api/products:
  → Redis: данные есть (cache hit)
  → Ответ: { "source": "cache", "data": [...] }

После PUT /api/products/:id:
  → Redis: удалить ключ products:all и products:<id>
  → Следующий GET снова пойдёт на сервер
```

### Кэшируемые маршруты

| Маршрут | TTL | Ключ в Redis |
|---------|-----|-------------|
| `GET /api/products` | 10 минут | `products:all` |
| `GET /api/products/:id` | 10 минут | `products:<id>` |
| `GET /api/users` | 1 минута | `users:all` |
| `GET /api/users/:id` | 1 минута | `users:<id>` |

### Проверка кэша

```bash
# После логина получить токен
TOKEN="<accessToken>"

# Первый вызов — source: "server"
curl http://localhost:3002/api/products -H "Authorization: Bearer $TOKEN"

# Второй вызов — source: "cache"
curl http://localhost:3002/api/products -H "Authorization: Bearer $TOKEN"
```

---

## Practice 22 — Nginx балансировка нагрузки

**Порт:** `8080` (Nginx) → три backend-сервера

### Что это

Один сервер TechStore не может обработать миллион запросов в секунду. Решение — запустить несколько одинаковых серверов и поставить перед ними Nginx, который равномерно распределяет запросы между ними.

### Как запустить

```bash
cd KR4/Practice-22
npm install        # зависимости для Node.js
docker compose up --build

# Остановить
docker compose down
```

### Как устроено

```
Клиент → :8080 → Nginx (балансировщик)
                    ├── backend-1:3000
                    ├── backend-2:3000  (Round Robin)
                    └── backend-3:3000  (резервный, включается если 1 и 2 недоступны)
```

- **Round Robin** — запросы распределяются по кругу: 1-й → backend-1, 2-й → backend-2, 3-й → backend-1...
- **Backup** — backend-3 не получает запросы пока работают основные
- **Отказоустойчивость** — если сервер не ответил 2 раза (`max_fails=2`), Nginx исключает его на 30 секунд (`fail_timeout=30s`)

### Тестирование

```bash
# Видно чередование серверов
for i in {1..4}; do curl -s http://localhost:8080/ | grep server; done
# → backend-1
# → backend-2
# → backend-1
# → backend-2

# Остановить один сервер
docker compose stop backend1

# Теперь весь трафик идёт через backend-2
curl http://localhost:8080/api/products
```

---

## Practice 23 — Docker Compose + Микросервисы

**Порт:** `8000` (API Gateway)

### Что это

В предыдущих практиках TechStore — это один сервер, который делает всё: авторизацию, управление пользователями, управление товарами. В Practice 23 приложение разбито на три независимых сервиса, каждый в своём Docker-контейнере.

### Как запустить

```bash
cd KR4/Practice-23
docker compose up --build

# Остановить
docker compose down
```

### Архитектура

```
Клиент → :8000
              ↓
        api_gateway          ← единственная точка входа
        (Circuit Breaker)
          /         \
service_users     service_products
(auth + RBAC)     (товары TechStore)
```

- **service_users** — регистрация, логин, управление пользователями. Никто снаружи не может обратиться к нему напрямую.
- **service_products** — CRUD товаров TechStore. Тоже закрыт снаружи.
- **api_gateway** — принимает все запросы, проверяет авторизацию через service_users, проксирует к нужному сервису.

Сервисы общаются по именам (`http://service_users:8000`) — Docker сам резолвит их в IP-адреса внутри сети.

### Circuit Breaker

Защищает от каскадных сбоев. Если service_products упал, gateway не будет каждый раз ждать таймаута — после 3 ошибок он «открывается» и сразу возвращает понятное сообщение об ошибке. Через 10 секунд делает пробный запрос, и если сервис восстановился — снова начинает пропускать трафик.

```
Нормальная работа:   CLOSED → запросы проходят
После 3 ошибок:      OPEN   → сразу возвращает ошибку (без ожидания)
Через 10 секунд:     HALF_OPEN → пробный запрос
Если сервис ожил:    CLOSED → снова нормальная работа
```

### API

```
GET  /status                    — состояние gateway и Circuit Breaker

POST /api/auth/register         — регистрация
POST /api/auth/login            — вход
POST /api/auth/refresh          — обновить токен

GET    /api/products            — список товаров
GET    /api/products/:id        — товар по ID
POST   /api/products            — добавить (seller, admin)
PUT    /api/products/:id        — изменить (seller, admin)
DELETE /api/products/:id        — удалить (admin)

GET    /api/users               — список пользователей (admin)
PUT    /api/users/:id           — изменить (admin)
DELETE /api/users/:id           — заблокировать (admin)

GET    /api/users/:id/overview  — агрегация: пользователь + все товары (admin)
```

### Пример работы

```bash
# Регистрация через gateway (он проксирует в service_users)
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ts.com","first_name":"Иван","last_name":"Петров","password":"pass123","role":"admin"}'

# Вход
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ts.com","password":"pass123"}'

# Товары (gateway проверяет токен через service_users, затем запрашивает service_products)
curl http://localhost:8000/api/products \
  -H "Authorization: Bearer <accessToken>"

# Проверить Circuit Breaker
docker compose stop service_products
curl http://localhost:8000/api/products -H "Authorization: Bearer <accessToken>"
# → {"error": "products service temporarily unavailable"}

curl http://localhost:8000/status
# → {"circuitBreakers": [{"name": "products", "state": "OPEN", "failures": 3}]}
```

---

## Запуск всех сервисов

| Практика | Команда | Порт |
|----------|---------|------|
| Practice 19 | `cd Practice-19 && node server.js` | 3000 |
| Practice 20 | `docker run -d --name mongo-kr4 -p 27017:27017 mongo:7` → `cd Practice-20 && node server.js` | 3001 |
| Practice 21 | `docker run -d --name redis-kr4 -p 6379:6379 redis:alpine` → `cd Practice-21 && node server.js` | 3002 |
| Practice 22 | `cd Practice-22 && docker compose up --build` | 8080 |
| Practice 23 | `cd Practice-23 && docker compose up --build` | 8000 |
