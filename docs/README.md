# CorpMeet — Система бронирования переговорных

## Что это

CorpMeet — корпоративная система бронирования переговорной комнаты. Пользователи создают встречи через веб-интерфейс или Telegram Mini App, получают уведомления в Telegram-группу и личные напоминания за 15 минут.

## Стек технологий

**Бэкенд** — Python 3.11+, FastAPI 0.111, SQLAlchemy 2.0 (async), asyncpg, PostgreSQL, python-jose (JWT), aiogram 3.x, httpx.

**Фронтенд** — React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, React Query (TanStack), Axios.

**Telegram Bot** — aiogram 3.x, работает внутри того же процесса FastAPI как набор asyncio-задач.

## Основные возможности

- Недельный календарь с 30-минутными слотами (7:00–22:00)
- Создание, редактирование, удаление встреч
- Повторяющиеся встречи (ежедневно, еженедельно, по выбранным дням)
- Приглашение гостей с автодополнением по @username
- Уведомления о новых/изменённых встречах в Telegram-группу
- Личные напоминания за 15 минут до начала
- Экспорт календаря в iCal (.ics) и публичный iCal-фид
- Авторизация через Telegram Mini App initData + QR/deep-link для браузера
- Тёмная и светлая тема
- Админ-панель: управление пользователями, ролями, статистика
- Drag & drop для переноса встреч на календаре

## Быстрый старт

```bash
# Бэкенд
cd web/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # заполнить переменные
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Фронтенд
cd web/frontend
npm install
npm run dev
```

При старте uvicorn автоматически:
1. Применяет миграции БД (ALTER TABLE IF NOT EXISTS)
2. Запускает Telegram-бот (aiogram polling)
3. Запускает фоновые задачи уведомлений и напоминаний

## Документация

| Файл | Описание |
|------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Архитектура, компоненты, потоки данных |
| [API.md](API.md) | Полный справочник API-эндпоинтов |
| [USER_GUIDE.md](USER_GUIDE.md) | Руководство пользователя |
| `interactive-guide.html` | Интерактивный гайд (открыть в браузере) |

## Структура проекта

```
web/
├── backend/
│   ├── app/
│   │   ├── api/v1/           Роутеры: auth, bookings, slots, users, internal
│   │   ├── bot/              TG Bot: handlers, tasks (notifications, reminders)
│   │   ├── models/           ORM: User, Booking, BrowserSession
│   │   ├── schemas/          Pydantic: запросы и ответы
│   │   ├── services/         Бизнес-логика: auth_service, slot_service
│   │   ├── config.py         Конфигурация из .env
│   │   ├── database.py       AsyncSession, engine
│   │   ├── dependencies.py   JWT-авторизация
│   │   └── main.py           Точка входа FastAPI + Bot lifespan
│   └── requirements.txt
│
└── frontend/
    └── src/
        ├── api/              HTTP-клиенты (axios)
        ├── components/       React-компоненты
        ├── hooks/            useAuth, useBookings, useTelegram
        ├── contexts/         ThemeContext, CalendarDragContext
        ├── types/            TypeScript-типы
        └── utils/            storage, telegram helpers
```

## Переменные окружения

```env
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/corpmeet
TELEGRAM_BOT_TOKEN=...
JWT_SECRET=...
FRONTEND_URL=http://localhost:5173
APP_TIMEZONE=Asia/Yekaterinburg
BOT_SECRET=случайный-токен-для-internal-api
TG_GROUP_CHAT_ID=...
INTERNAL_API_URL=http://127.0.0.1:8000
```
