# CorpMeet — Справочник API

Базовый URL: `http://localhost:8000/api/v1`

Все эндпоинты (кроме `/internal/*`) используют JWT Bearer авторизацию:
```
Authorization: Bearer <jwt_token>
```

---

## Авторизация `/auth`

### POST `/auth/register`

Регистрация нового пользователя через Telegram Mini App.

```json
// Request
{
  "initData": "query_id=...&user=...&hash=...",
  "first_name": "Тимур",
  "last_name": "Калипилин"
}

// Response 201
{
  "access_token": "eyJ...",
  "expires_in": 604800
}
```

Ошибки: `400` — пустые имя/фамилия, невалидный initData, пользователь уже зарегистрирован.

### POST `/auth/login`

Вход существующего пользователя.

```json
// Request
{ "initData": "query_id=...&user=...&hash=..." }

// Response 200
{ "access_token": "eyJ...", "expires_in": 604800 }
```

Ошибки: `404` — пользователь не зарегистрирован.

### POST `/auth/browser/session`

Создать одноразовый токен для авторизации в браузере. Требует JWT.

```json
// Response 200
{
  "session_token": "abc123...",
  "browser_url": "http://localhost:5173/auth/session/abc123..."
}
```

### GET `/auth/session/{session_token}`

Обменять одноразовый токен на JWT (для браузера).

```json
// Response 200
{ "access_token": "eyJ...", "expires_in": 604800 }
```

Ошибки: `401` — токен невалидный, истёк или уже использован.

### GET `/auth/me`

Текущий пользователь.

```json
// Response 200
{
  "id": 1,
  "telegram_id": 123456789,
  "first_name": "Тимур",
  "last_name": "Калипилин",
  "username": "timur",
  "role": "admin",
  "display_name": "Тимур Калипилин"
}
```

### POST `/auth/dev-login`

Dev-only. Создаёт тестового пользователя и возвращает JWT. Не требует авторизации.

---

## Встречи `/bookings`

### GET `/bookings?date_from=2026-03-27&date_to=2026-03-27`

Список встреч за период. Если `date_to` не указан — берётся `date_from`.

```json
// Response 200
[
  {
    "id": 42,
    "title": "Планёрка",
    "description": "Обсуждение спринта",
    "start_time": "2026-03-27T10:00:00Z",
    "end_time": "2026-03-27T11:00:00Z",
    "user_id": 1,
    "user": { "id": 1, "display_name": "Тимур Калипилин", ... },
    "guests": ["ivan", "maria"],
    "recurrence": "weekly",
    "recurrence_group_id": 1711545600000,
    "created_at": "2026-03-20T08:00:00Z"
  }
]
```

### GET `/bookings/active`

Активные встречи текущего пользователя (до 30 дней вперёд).

### POST `/bookings`

Создать встречу. Если `recurrence != "none"` — создаётся серия (до 90 шт).

```json
// Request
{
  "title": "Планёрка",
  "description": "Обсуждение спринта",
  "start_time": "2026-03-27T10:00:00Z",
  "end_time": "2026-03-27T11:00:00Z",
  "guests": ["ivan", "maria"],
  "recurrence": "weekly",
  "recurrence_until": "2026-06-27",
  "recurrence_days": []
}

// Response 201 — массив созданных встреч
[{ "id": 42, ... }, { "id": 43, ... }]
```

Валидация: 15 мин ≤ длительность ≤ 8 часов, не в прошлом, нет конфликтов.

### PATCH `/bookings/{id}`

Изменить встречу. Если время меняется — `reminder_sent` сбрасывается.

```json
// Request (все поля опциональны)
{
  "title": "Новое название",
  "start_time": "2026-03-27T14:00:00Z",
  "end_time": "2026-03-27T15:00:00Z",
  "guests": ["ivan"]
}
```

Ошибки: `403` — не владелец и не админ, `409` — конфликт времени.

### DELETE `/bookings/{id}?delete_series=false`

Удалить встречу. `delete_series=true` удаляет все будущие встречи серии.

### GET `/bookings/export`

Скачать все встречи пользователя как `.ics` файл.

### GET `/bookings/feed/{feed_token}`

Публичный iCal-фид (без авторизации). `feed_token` получить через POST `/users/feed-token`.

### GET `/bookings/admin/all`

Все встречи (до 200 шт). Только для admin.

---

## Слоты `/slots`

### GET `/slots?date=2026-03-27`

Свободные 30-минутные слоты на день (7:00–22:00).

```json
// Response 200
[
  { "start": "07:00", "end": "07:30", "available": true },
  { "start": "07:30", "end": "08:00", "available": true },
  { "start": "10:00", "end": "10:30", "available": false },
  ...
]
```

---

## Пользователи `/users`

### GET `/users/me`

Текущий пользователь (аналог `/auth/me`).

### GET `/users/search?q=тим`

Поиск по имени, фамилии или @username. Без `q` — все пользователи (до 50).

### POST `/users/feed-token`

Создать или получить `feed_token` для iCal-фида.

```json
// Response 200
{ "feed_token": "abc123..." }
```

### GET `/users/admin/users` (admin)

Все пользователи.

### PATCH `/users/admin/users/{id}/role` (admin)

Сменить роль.

```json
// Request
{ "role": "admin" }
```

### GET `/users/admin/stats` (admin)

Статистика.

```json
{ "total_users": 25, "total_bookings": 142, "active_bookings": 3 }
```

---

## Внутренний API `/internal` (только для TG Bot)

Все эндпоинты требуют заголовок:
```
X-Bot-Secret: <значение BOT_SECRET из .env>
```

### GET `/internal/bookings/since?updated_at=2026-03-27T10:00:00Z`

Встречи обновлённые после указанного времени (для уведомлений).

```json
// Response 200
[
  {
    "id": 42,
    "title": "Планёрка",
    "description": "...",
    "start_time": "2026-03-27T10:00:00Z",
    "end_time": "2026-03-27T11:00:00Z",
    "guests": ["ivan"],
    "reminder_sent": false,
    "created_at": "2026-03-27T09:00:00Z",
    "updated_at": "2026-03-27T09:30:00Z",
    "user": {
      "id": 1,
      "telegram_id": 123456789,
      "username": "timur",
      "display_name": "Тимур Калипилин"
    }
  }
]
```

### GET `/internal/bookings/reminders`

Встречи через 14-16 мин с `reminder_sent = false`. Формат ответа аналогичен.

### POST `/internal/bookings/{id}/mark-reminded`

Пометить `reminder_sent = true`.

```json
// Response 200
{ "ok": true, "id": 42 }
```

### POST `/internal/users/ensure`

Создать пользователя из данных Telegram (или обновить username).

```json
// Request
{
  "telegram_id": 123456789,
  "first_name": "Тимур",
  "last_name": "Калипилин",
  "username": "timur",
  "full_name": "Тимур Калипилин"
}

// Response 200
{ "ok": true, "created": true }
```

### GET `/internal/users/by-username/{username}`

Найти `telegram_id` по @username (для личных уведомлений).

```json
// Response 200
{ "telegram_id": 123456789, "display_name": "Тимур Калипилин" }
```

Ошибки: `404` — пользователь не найден или нет telegram_id.

### POST `/internal/auth/consume-session`

QR/deep-link авторизация — сжечь browser session и привязать telegram_id.

```json
// Request
{ "token": "abc123...", "telegram_id": 123456789 }

// Response 200
{ "ok": true }
```

Ошибки: `404` — сессия не найдена, `410` — использована или истекла.
