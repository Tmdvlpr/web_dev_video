# CorpMeet — Web Backend: функционал, эндпоинты и связь с TG Bot

## Обзор архитектуры

Проект состоит из двух независимых сервисов, взаимодействующих через HTTP:

```
┌─────────────────────────────────────────┐        ┌──────────────────────────────┐
│           web/backend (FastAPI)         │◄──────►│     tg/tg (Aiogram Bot)      │
│                                         │  HTTP  │                              │
│  • REST API для фронтенда (JWT)         │        │  • Polling / Webhook         │
│  • Internal API для TG Bot              │        │  • api_client.py (HTTP)      │
│  • Фоновые задачи: уведомления,         │        │  • Без прямого доступа к БД  │
│    напоминания (aiogram + httpx)        │        └──────────────────────────────┘
└─────────────────────────────────────────┘
               ▲
               │ JWT / Cookie
               ▼
┌─────────────────────────────────────────┐
│        web/frontend (React + Vite)      │
│  • SPA, обслуживается тем же FastAPI    │
│  • Telegram Mini App (initData auth)    │
└─────────────────────────────────────────┘
```

**Стек:**
- Backend: Python 3.11+, FastAPI, SQLAlchemy (async), PostgreSQL
- Frontend: React, TypeScript, Vite, Tailwind CSS
- TG Bot: Python, Aiogram 3.x
- Аутентификация: JWT (Bearer), Telegram initData (HMAC-SHA256)

---

## Переменные окружения (backend)
![alt text](image.png)
| Переменная | Описание |
|---|---|
| `DATABASE_URL` | Строка подключения к PostgreSQL |
| `TELEGRAM_BOT_TOKEN` | Токен бота (для верификации initData) |
| `JWT_SECRET` | Секрет для подписи JWT |
| `JWT_EXPIRE_DAYS` | Срок действия JWT (по умолчанию 7 дней) |
| `FRONTEND_URL` | URL фронтенда для CORS |
| `APP_TIMEZONE` | Часовой пояс (по умолчанию `Europe/Moscow`) |
| `TG_GROUP_CHAT_ID` | ID группы для уведомлений |
| `BOT_SECRET` | Секретный заголовок `X-Bot-Secret` для внутреннего API |
| `TG_BOT_USERNAME` | Username бота (без @), используется в QR-ссылках |

---

## База данных: модели

| Таблица | Ключевые поля |
|---|---|
| `users` | `id`, `telegram_id`, `first_name`, `last_name`, `username`, `role` (user/admin), `is_registered`, `feed_token` |
| `bookings` | `id`, `title`, `description`, `start_time`, `end_time`, `user_id`, `guests` (JSONB), `recurrence`, `recurrence_group_id`, `reminder_sent`, `deleted_at` |
| `browser_sessions` | `id`, `token`, `user_id` (nullable), `used`, `expires_at` — одноразовые токены для QR/deep-link авторизации |

---

## REST API — Публичные эндпоинты

Все публичные эндпоинты имеют префикс `/api/v1`. Авторизованные запросы используют заголовок `Authorization: Bearer <JWT>`.

---

### `/api/v1/auth` — Аутентификация

#### `POST /api/v1/auth/register`
Регистрация нового пользователя через Telegram Mini App.

**Тело запроса:**
```json
{
  "initData": "<строка initData из Telegram>",
  "first_name": "Иван",
  "last_name": "Иванов"
}
```
**Ответ:** `{ "access_token": "...", "expires_in": 604800 }`

Верифицирует `initData` через HMAC-SHA256 с ключом `WebAppData`. Создаёт пользователя в БД. Возвращает `400`, если пользователь уже зарегистрирован.

---

#### `POST /api/v1/auth/login`
Авторизация существующего пользователя через Telegram Mini App.

**Тело запроса:**
```json
{ "initData": "<строка initData из Telegram>" }
```
**Ответ:** `{ "access_token": "...", "expires_in": 604800 }`

Возвращает `404`, если пользователь не найден (не зарегистрирован).

---

#### `GET /api/v1/auth/me`
Возвращает профиль текущего авторизованного пользователя. Требует JWT.

---

#### `POST /api/v1/auth/browser/session`
Создаёт одноразовый токен для открытия веб-приложения из Telegram Mini App. Требует JWT.

**Ответ:**
```json
{
  "session_token": "abc123...",
  "browser_url": "https://app.example.com/auth/session/abc123..."
}
```

---

#### `POST /api/v1/auth/qr-session`
Создаёт QR-сессию без авторизации. Возвращает токен и deep-link на бота. Браузер открывает QR-код, пользователь сканирует и запускает бота.

**Ответ:**
```json
{
  "token": "xyz...",
  "bot_url": "https://t.me/mybotname?start=xyz...",
  "expires_in": 300
}
```

---

#### `GET /api/v1/auth/session/{session_token}`
Проверяет/потребляет сессионный токен. Используется браузером для опроса статуса QR-авторизации.

- **202** — сессия ещё не подтверждена ботом (`{ "status": "pending" }`)
- **200** — возвращает JWT (`{ "access_token": "..." }`)
- **410** — сессия истекла или уже использована

---

#### `POST /api/v1/auth/web-register`
Регистрация напрямую через веб (без Telegram). Создаёт пользователя без `telegram_id`.

**Тело запроса:**
```json
{ "first_name": "Иван", "last_name": "Иванов" }
```

---

#### `POST /api/v1/auth/dev-login` *(только при `CORPMEET_DEV=1`)*
Dev-режим: мгновенный вход без Telegram. Создаёт тестового пользователя с `telegram_id=999000001`.

---

### `/api/v1/bookings` — Бронирования

#### `GET /api/v1/bookings`
Список бронирований за указанный период. Требует JWT.

**Query-параметры:**
- `date_from` — дата начала (YYYY-MM-DD), обязательный
- `date_to` — дата конца (YYYY-MM-DD), опциональный (по умолчанию = `date_from`)

**Ответ:** массив объектов `BookingResponse`.

---

#### `POST /api/v1/bookings`
Создать бронирование. Требует JWT.

**Тело запроса:**
```json
{
  "title": "Планёрка",
  "description": "Обсуждение квартального плана",
  "start_time": "2026-04-05T10:00:00Z",
  "end_time": "2026-04-05T11:00:00Z",
  "guests": ["@username1", "@username2"],
  "recurrence": "none",
  "recurrence_until": null,
  "recurrence_days": []
}
```

Поле `recurrence` принимает: `none`, `daily`, `weekly`, `custom`. При `custom` нужно передать `recurrence_days` — список дней недели (0=пн, 6=вс). При конфликте времени возвращает `409`.

**Ответ:** массив созданных бронирований (при повторении — несколько записей).

---

#### `PATCH /api/v1/bookings/{booking_id}`
Обновить бронирование. Требует JWT. Владелец или admin.

**Тело запроса** (все поля опциональны):
```json
{
  "title": "...",
  "description": "...",
  "start_time": "...",
  "end_time": "...",
  "guests": ["@user"]
}
```

При изменении времени сохраняет `prev_start_time` / `prev_end_time` (используется ботом для уведомления «время изменено»).

---

#### `DELETE /api/v1/bookings/{booking_id}`
Мягкое удаление бронирования (устанавливает `deleted_at`). Требует JWT.

**Query-параметры:**
- `delete_series=true` — удалить всю серию повторяющихся бронирований

---

#### `GET /api/v1/bookings/active`
Ближайшие активные бронирования текущего пользователя (на 30 дней вперёд). Требует JWT.

---

#### `GET /api/v1/bookings/admin/all`
Все бронирования системы (последние 200). Только для роли `admin`.

---

#### `GET /api/v1/bookings/export`
Экспорт бронирований текущего пользователя в формат iCalendar (`.ics`). Требует JWT.

---

#### `GET /api/v1/bookings/feed/{feed_token}`
Публичный iCalendar-фид пользователя. Не требует JWT — доступ по персональному `feed_token`. Подходит для подключения в Google Calendar, Apple Calendar и т.д. Обновляется каждые 15 минут (`REFRESH-INTERVAL`).

---

### `/api/v1/slots` — Слоты

#### `GET /api/v1/slots?date=YYYY-MM-DD`
Возвращает список временных слотов на указанный день с флагом `available`. Требует JWT.

**Ответ:**
```json
[
  { "start": "09:00", "end": "09:30", "available": true },
  { "start": "09:30", "end": "10:00", "available": false }
]
```

---

### `/api/v1/users` — Пользователи

#### `GET /api/v1/users/me`
Профиль текущего пользователя. Требует JWT.

#### `GET /api/v1/users/search?q=...`
Поиск пользователей по имени или `@username`. Требует JWT. Возвращает до 50 результатов.

#### `POST /api/v1/users/feed-token`
Генерирует и возвращает персональный `feed_token` для iCal-фида. Требует JWT.

#### `GET /api/v1/users/admin/users`
Список всех пользователей системы. Только `admin`.

#### `POST /api/v1/users/admin/users`
Создать пользователя вручную (без Telegram). Только `admin`.

#### `PATCH /api/v1/users/admin/users/{user_id}/role`
Изменить роль пользователя (`user` / `admin`). Только `admin`.

#### `DELETE /api/v1/users/admin/users/{user_id}`
Удалить пользователя и мягко удалить все его бронирования. Только `admin`.

#### `GET /api/v1/users/admin/stats`
Статистика: `total_users`, `total_bookings`, `active_bookings`. Только `admin`.

---

### Системный

#### `GET /health`
Проверка работоспособности бэкенда. Возвращает `{ "status": "ok" }`.

---

## Internal API — Только для TG Bot

Эндпоинты с префиксом `/api/v1/internal/` предназначены исключительно для TG Bot. Защищены заголовком:

```
X-Bot-Secret: <значение BOT_SECRET>
```

Без корректного заголовка возвращается `401 Unauthorized`. Если `BOT_SECRET` не задан — `503 Service Unavailable`.

---

### Бронирования

#### `GET /api/v1/internal/bookings/since?updated_at=<ISO>`
Возвращает все бронирования, изменённые после указанного момента. Используется ботом для отправки уведомлений в группу и гостям.

#### `GET /api/v1/internal/bookings/reminders`
Возвращает бронирования, которые начнутся через 14–16 минут и у которых `reminder_sent = false`. Бот вызывает каждые 60 секунд.

#### `POST /api/v1/internal/bookings/{booking_id}/mark-reminded`
Устанавливает `reminder_sent = true` для указанного бронирования после успешной отправки напоминания.

#### `GET /api/v1/internal/bookings/deleted-since?since=<ISO>`
Бронирования, удалённые после указанного момента. Используется для отправки уведомлений об отмене.

---

### Пользователи

#### `POST /api/v1/internal/users/ensure`
Создаёт пользователя по данным Telegram, если его ещё нет в БД. Обновляет username при изменении. Вызывается при команде `/start` без токена.

**Тело запроса:**
```json
{
  "telegram_id": 123456789,
  "first_name": "Иван",
  "last_name": "Иванов",
  "username": "ivan",
  "full_name": "Иван Иванов"
}
```

#### `GET /api/v1/internal/users/by-username/{username}`
Возвращает `telegram_id` пользователя по username. Используется для отправки личных сообщений гостям.

---

### Авторизация

#### `POST /api/v1/internal/auth/consume-session`
Сжигает browser_session токен при QR/deep-link авторизации. Привязывает `telegram_id` к пользователю.

**Тело запроса:**
```json
{ "token": "xyz...", "telegram_id": 123456789 }
```

Вызывается ботом при команде `/start <token>`. После этого браузер забирает JWT через `GET /api/v1/auth/session/{token}`.

---

## Связь Web Backend ↔ TG Bot

### Схема взаимодействия

```
TG Bot (tg/tg/)                             Web Backend (web/backend/)
       │                                            │
       │── api_client.py ──────────────────────────►│
       │   aiohttp.ClientSession                    │
       │   base_url = BACKEND_URL                   │
       │   headers: X-Bot-Secret                    │
       │                                            │
       │  JWT-запросы (от имени пользователей):     │
       │    POST /api/v1/auth/login                 │
       │    GET  /api/v1/bookings                   │
       │    POST /api/v1/bookings                   │
       │    DELETE /api/v1/bookings/{id}            │
       │    GET  /api/v1/slots                      │
       │                                            │
       │  Internal API:                             │
       │    GET  /api/v1/internal/bookings/since    │
       │    GET  /api/v1/internal/bookings/reminders│
       │    POST /api/v1/internal/.../mark-reminded │
       │    POST /api/v1/internal/users/ensure      │
       │    GET  /api/v1/internal/users/by-username │
       │    POST /api/v1/internal/auth/consume-session│
       │                                            │
       │◄── HTTP responses (JSON) ──────────────────│
```

### Как бот получает JWT пользователя

TG Bot не хранит пароли. Вместо этого `api_client.py` строит валидную `initData`-строку:

1. Формирует JSON-объект пользователя из его Telegram-данных
2. Подписывает его через HMAC-SHA256 с ключом `WebAppData` + `BOT_TOKEN`
3. Отправляет `POST /api/v1/auth/login` с `initData`
4. Кэширует полученный JWT в памяти (с учётом времени истечения)

Таким образом бот может делать API-запросы от имени пользователя без хранения отдельных паролей.

### QR / Deep-link авторизация (Browser Session Flow)

```
Браузер                    TG Bot                   Backend
   │                          │                        │
   │── POST /auth/qr-session ─────────────────────────►│
   │◄── { token, bot_url } ───────────────────────────│
   │                          │                        │
   │  (показывает QR-код)     │                        │
   │                          │                        │
   │              Пользователь сканирует QR            │
   │                          │                        │
   │                /start <token>                     │
   │                          │── POST /internal/auth/consume-session ──►│
   │                          │   { token, telegram_id }                 │
   │                          │◄── { ok: true } ────────────────────────│
   │                          │                        │
   │── GET /auth/session/{token} ─────────────────────►│
   │◄── { access_token: JWT } ────────────────────────│
   │                          │                        │
   │  (авторизован в браузере)│                        │
```

### Фоновые задачи (Background Tasks)

В backend-е запущены два asyncio-таска (через aiogram + httpx):

#### Уведомления о бронированиях (`notifications.py`)
- Запускается каждые **60 секунд**
- Запрашивает `GET /api/v1/internal/bookings/since?updated_at=<last_check>`
- Для **новых** бронирований отправляет в группу сообщение «📅 Новое бронирование» и личные сообщения приглашённым гостям
- Для **изменённых** бронирований отправляет «✏️ Бронирование изменено»
- Находит `telegram_id` гостей через `GET /api/v1/internal/users/by-username/{username}`

#### Напоминания (`reminders.py`)
- Запускается каждые **60 секунд**
- Запрашивает `GET /api/v1/internal/bookings/reminders` — встречи через 14–16 минут, `reminder_sent = false`
- Отправляет «⏰ Напоминание! Через 15 минут» в группу, организатору лично и гостям лично
- После успешной отправки вызывает `POST /api/v1/internal/bookings/{id}/mark-reminded`

### Архитектурное решение

TG Bot (контейнер `tg`) **не имеет прямого доступа к БД**. Весь доступ к данным происходит через HTTP-запросы к Backend API. Это обеспечивает:
- Чёткое разделение ответственности
- Независимое масштабирование сервисов
- Единую точку бизнес-логики (валидация, проверка конфликтов) в Backend

---

## Итоговая таблица эндпоинтов

| Метод | Путь | Авторизация | Описание |
|---|---|---|---|
| POST | `/api/v1/auth/register` | — | Регистрация через Telegram Mini App |
| POST | `/api/v1/auth/login` | — | Вход через Telegram Mini App |
| GET | `/api/v1/auth/me` | JWT | Профиль текущего пользователя |
| POST | `/api/v1/auth/browser/session` | JWT | Создать одноразовую браузерную сессию |
| POST | `/api/v1/auth/qr-session` | — | Создать QR-сессию |
| GET | `/api/v1/auth/session/{token}` | — | Проверить/получить JWT по сессионному токену |
| POST | `/api/v1/auth/web-register` | — | Регистрация без Telegram |
| GET | `/api/v1/bookings` | JWT | Список бронирований по датам |
| POST | `/api/v1/bookings` | JWT | Создать бронирование |
| PATCH | `/api/v1/bookings/{id}` | JWT | Обновить бронирование |
| DELETE | `/api/v1/bookings/{id}` | JWT | Удалить бронирование |
| GET | `/api/v1/bookings/active` | JWT | Ближайшие бронирования пользователя |
| GET | `/api/v1/bookings/export` | JWT | Экспорт в iCalendar (.ics) |
| GET | `/api/v1/bookings/feed/{feed_token}` | — | Публичный iCal-фид |
| GET | `/api/v1/bookings/admin/all` | JWT (admin) | Все бронирования системы |
| GET | `/api/v1/slots` | JWT | Слоты на дату с флагом доступности |
| GET | `/api/v1/users/me` | JWT | Профиль текущего пользователя |
| GET | `/api/v1/users/search` | JWT | Поиск пользователей |
| POST | `/api/v1/users/feed-token` | JWT | Получить/создать feed_token |
| GET | `/api/v1/users/admin/users` | JWT (admin) | Список всех пользователей |
| POST | `/api/v1/users/admin/users` | JWT (admin) | Создать пользователя вручную |
| PATCH | `/api/v1/users/admin/users/{id}/role` | JWT (admin) | Изменить роль пользователя |
| DELETE | `/api/v1/users/admin/users/{id}` | JWT (admin) | Удалить пользователя |
| GET | `/api/v1/users/admin/stats` | JWT (admin) | Статистика системы |
| GET | `/api/v1/internal/bookings/since` | X-Bot-Secret | Изменённые бронирования (для уведомлений) |
| GET | `/api/v1/internal/bookings/reminders` | X-Bot-Secret | Бронирования для напоминания |
| POST | `/api/v1/internal/bookings/{id}/mark-reminded` | X-Bot-Secret | Пометить напоминание отправленным |
| GET | `/api/v1/internal/bookings/deleted-since` | X-Bot-Secret | Удалённые бронирования |
| POST | `/api/v1/internal/users/ensure` | X-Bot-Secret | Создать/обновить пользователя из Telegram |
| GET | `/api/v1/internal/users/by-username/{username}` | X-Bot-Secret | Получить telegram_id по username |
| POST | `/api/v1/internal/auth/consume-session` | X-Bot-Secret | Сжечь браузерную сессию (QR-авторизация) |
| GET | `/health` | — | Healthcheck |
