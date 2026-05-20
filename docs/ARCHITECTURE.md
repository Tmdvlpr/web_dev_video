# Архитектура CorpMeet

## Общая схема

Вся система работает как **один процесс `uvicorn`**. Внутри него три компонента:

```
┌──────────────────────────────────────────────────────────────────┐
│                    uvicorn (один процесс)                        │
│                                                                  │
│  ┌─────────────────────────────┐   ┌──────────────────────────┐  │
│  │  FastAPI Routes             │   │  TG Bot (asyncio tasks)  │  │
│  │                             │   │                          │  │
│  │  /api/v1/auth/*             │   │  aiogram polling         │  │
│  │  /api/v1/bookings/*         │   │  notifications (60s)     │  │
│  │  /api/v1/slots/*            │   │  reminders (60s)         │  │
│  │  /api/v1/users/*            │   │                          │  │
│  │  /api/v1/internal/*         │◄──│  httpx + X-Bot-Secret    │  │
│  │                             │   │                          │  │
│  └────────────┬────────────────┘   └──────────────────────────┘  │
│               │                                                  │
│               ▼                                                  │
│  ┌─────────────────────────────┐                                 │
│  │  SQLAlchemy AsyncSession    │                                 │
│  │  (один пул соединений)      │                                 │
│  └────────────┬────────────────┘                                 │
└───────────────┼──────────────────────────────────────────────────┘
                │
                ▼
       ┌─────────────────┐
       │  PostgreSQL      │
       │  :5432           │
       └─────────────────┘
```

Клиенты подключаются извне:

```
React Web App (браузер)       ──HTTP──►  /api/v1/* (JWT Bearer)
Telegram Mini App (WebView)   ──HTTP──►  /api/v1/* (JWT Bearer)
TG Bot (внутри процесса)      ──HTTP──►  /api/v1/internal/* (X-Bot-Secret)
```

Ключевое правило: **TG Bot не обращается к базе данных напрямую**. Все операции с данными проходят через эндпоинты бэкенда.

---

## Жизненный цикл приложения

При запуске `uvicorn app.main:app` срабатывает функция `lifespan`:

### 1. Миграции БД
Все ALTER TABLE и CREATE TABLE выполняются с `IF NOT EXISTS` — безопасно перезапускать без потери данных. Миграции добавляют новые колонки в `users` и `bookings`, создают таблицу `browser_sessions`.

### 2. Запуск бота
Создаётся объект `Bot` (aiogram) и `Dispatcher` с зарегистрированными хендлерами. Три asyncio-задачи запускаются параллельно:

- `dp.start_polling(bot)` — получение команд от пользователей через Telegram API
- `run_notification_task(bot)` — проверка новых/изменённых встреч каждые 60 сек
- `run_reminder_task(bot)` — проверка встреч для напоминания каждые 60 сек

### 3. FastAPI обрабатывает HTTP-запросы
Все asyncio-задачи работают в одном event loop с FastAPI — никакого threading.

### 4. Graceful shutdown
При остановке (Ctrl+C, SIGTERM) все задачи бота отменяются через `task.cancel()`, сессия бота закрывается.

---

## Аутентификация

### Поток Mini App

1. Пользователь открывает Mini App в Telegram
2. Telegram вставляет `initData` (подписанные HMAC данные пользователя)
3. Фронтенд отправляет `initData` на POST `/api/v1/auth/register` или `/auth/login`
4. Бэкенд проверяет HMAC-подпись с ключом `WebAppData` + bot_token
5. Проверяет свежесть (не старше 5 минут)
6. Создаёт/находит пользователя, возвращает JWT (7 дней)

### Поток «Открыть в браузере»

1. В Mini App пользователь нажимает «Открыть в браузере»
2. POST `/api/v1/auth/browser/session` создаёт одноразовый токен (5 мин TTL)
3. Браузер открывает URL `/auth/session/{token}`
4. GET `/api/v1/auth/session/{token}` сжигает токен, возвращает JWT
5. Пользователь авторизован в браузере

### Поток QR/Deep Link

1. На каком-то экране показывается QR-код с `t.me/corpmeetbot?start={token}`
2. Пользователь сканирует QR, открывается Telegram
3. Бот получает `/start {token}`, вызывает POST `/api/v1/internal/auth/consume-session`
4. Бэкенд сжигает токен, привязывает `telegram_id` к пользователю

### Dev-логин

POST `/api/v1/auth/dev-login` создаёт тестового пользователя (telegram_id=999000001) и возвращает JWT. Только для разработки.

---

## Модели данных

### User

| Поле | Тип | Описание |
|------|-----|----------|
| id | SERIAL PK | Внутренний ID |
| telegram_id | BIGINT UNIQUE | ID в Telegram |
| name | VARCHAR(255) | Полное имя (legacy) |
| first_name | VARCHAR(100) | Имя |
| last_name | VARCHAR(100) | Фамилия |
| username | VARCHAR(255) | @username |
| role | ENUM(user, admin) | Роль |
| is_active | BOOLEAN | Активен |
| is_registered | BOOLEAN | Завершил регистрацию |
| feed_token | VARCHAR(64) UNIQUE | Токен для iCal-фида |
| created_at | TIMESTAMPTZ | Создан |
| updated_at | TIMESTAMPTZ | Обновлён |

### Booking

| Поле | Тип | Описание |
|------|-----|----------|
| id | SERIAL PK | ID |
| title | VARCHAR(255) | Название |
| description | VARCHAR(2000) | Описание |
| start_time | TIMESTAMPTZ | Начало (UTC) |
| end_time | TIMESTAMPTZ | Конец (UTC) |
| user_id | INT FK | Организатор |
| guests | JSONB | `["username1", "username2"]` |
| recurrence | VARCHAR(10) | none / daily / weekly / custom |
| recurrence_until | DATE | Конец серии |
| recurrence_group_id | BIGINT | Группа серии |
| recurrence_days | JSONB | `[0,2,4]` (пн/ср/пт) |
| reminder_sent | BOOLEAN | Напоминание отправлено |
| deleted_at | TIMESTAMPTZ | Soft delete |
| created_at | TIMESTAMPTZ | Создан |
| updated_at | TIMESTAMPTZ | Обновлён |

### BrowserSession

| Поле | Тип | Описание |
|------|-----|----------|
| id | SERIAL PK | ID |
| token | VARCHAR(128) UNIQUE | Одноразовый токен |
| user_id | INT FK | Пользователь |
| used | BOOLEAN | Использован ли |
| used_at | TIMESTAMPTZ | Когда использован |
| expires_at | TIMESTAMPTZ | Истекает через 5 мин |
| created_at | TIMESTAMPTZ | Создан |

---

## Фронтенд

### Маршруты

| Путь | Компонент | Описание |
|------|-----------|----------|
| `/login` | LoginPage | Страница входа (анимированная) |
| `/register` | RegistrationPage | Форма имя + фамилия |
| `/auth/session/:token` | SessionAuthPage | Авторизация по токену |
| `/bookings` | Dashboard + Calendar | Основной экран |
| `/` | Redirect | → `/bookings` или `/login` |

### Основные компоненты

**Dashboard** — хедер с кнопками навигации (бронирование, мои встречи, уведомления, админка, тема, выход), основной контент — календарь.

**Calendar** — недельный вид, 30-минутные слоты 7:00–22:00. DayColumn рендерит каждый день. BookingCard — перетаскиваемая карточка встречи. Виджет статуса переговорной (сейчас занято/свободно).

**BookingModal** — форма создания/редактирования: заголовок, описание, дата/время, длительность (пресеты 30/60/90/120 мин), гости с автодополнением, повторение (ежедневно/еженедельно/по дням), проверка конфликтов.

**AdminPanel** — три вкладки: все встречи, все пользователи (смена ролей), статистика.

### Состояние

- **React Query** — кэширование и синхронизация серверных данных (staleTime 30s, 1 retry)
- **ThemeContext** — тёмная/светлая тема, сохраняется в localStorage
- **CalendarDragContext** — состояние drag & drop для переноса встреч
- **localStorage** — JWT-токен (`access_token`), тема (`meetaholic_theme`)

---

## TG Bot — потоки данных

### Уведомления (каждые 60 сек)

```
1. GET /api/v1/internal/bookings/since?updated_at=<last_check>
2. Для каждой встречи:
   - Если новая (created_at >= last_check):
     → Отправить в группу: "📅 Новое бронирование: {title}"
     → Для каждого гостя: GET /internal/users/by-username/{username}
     → Отправить личное: "📅 Вас пригласили на встречу!"
   - Если изменённая:
     → Отправить в группу: "✏️ Бронирование изменено: {title}"
3. last_check = now
```

### Напоминания (каждые 60 сек)

```
1. GET /api/v1/internal/bookings/reminders
   (возвращает встречи через 14-16 мин с reminder_sent=false)
2. Для каждой встречи:
   → Отправить в группу: "⏰ Напоминание! Через 15 мин: {title}"
   → Отправить организатору лично
   → Для каждого гостя: найти telegram_id, отправить лично
   → POST /internal/bookings/{id}/mark-reminded
```

---

## Безопасность

- JWT Bearer токены для всех публичных эндпоинтов (7 дней TTL)
- HMAC-подпись initData проверяется через WebAppData ключ
- Внутренние эндпоинты защищены заголовком `X-Bot-Secret`
- Одноразовые browser_session токены (5 мин TTL, сжигаются при использовании)
- CORS ограничен конкретными origins (FRONTEND_URL + localhost порты)
- Каскадное удаление: удаление пользователя удаляет его встречи и сессии
