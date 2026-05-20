# Промпт: интеграция Jitsi-видеоконференций в CorpMeet

> Скопируй и отправь этот промпт Claude Code (или другому LLM-агенту с правами на правку файлов). Промпт самодостаточный — содержит контекст проекта, точные пути к файлам, требования и acceptance criteria.

---

## КОНТЕКСТ ПРОЕКТА

Ты дорабатываешь **CorpMeet** — корпоративную систему бронирования переговорных комнат. Корневая папка проекта: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet`.

**Стек:**
- Backend: Python 3.11 + FastAPI 0.111 + SQLAlchemy 2.0 (async) + asyncpg + PostgreSQL 16. Папка `web/backend`. Pydantic v2.
- Frontend: React 18.3 + TypeScript 5.4 + Vite 5 + Tailwind 3.4 + TanStack Query 5 + axios + Framer Motion. Папка `web/frontend`.
- Bot: aiogram 3.10+, лежит внутри backend — `web/backend/app/bot`. Дёргает внутренние API с заголовком `X-Bot-Secret`.
- Auth: PASETO + Telegram initData (НЕ JWT — учитывай это, если будешь генерировать токены).
- Миграций Alembic НЕТ — схема правится через безопасные `ALTER TABLE IF NOT EXISTS` в `app/main.py` (lifespan startup). Добавляй новые колонки тем же паттерном.
- Docker: `docker-compose.yml` в корне, сервисы `db` (5433), `backend` (8050), `frontend` (3050).

**Ключевые файлы (абсолютные пути, читай через Read перед правкой):**
- Модель Booking: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\backend\app\models\booking.py`
- Схемы Pydantic: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\backend\app\schemas\booking.py`
- Роутер бронирований: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\backend\app\api\v1\bookings.py`
- Главный файл и автомиграции: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\backend\app\main.py`
- Конфиг (pydantic-settings): `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\backend\app\config.py`
- .env backend: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\backend\app\.env`
- TS-типы: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\frontend\src\types\index.ts`
- API-клиент бронирований: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\frontend\src\api\bookings.ts`
- Форма создания/редактирования брони: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\frontend\src\components\Dashboard\BookingModal.tsx`
- Карточка брони: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\frontend\src\components\Calendar\BookingCard.tsx`
- Reminders бота: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\backend\app\bot\tasks\reminders.py`
- Notifications бота: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\backend\app\bot\tasks\notifications.py`
- Входная точка фронта: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet\web\frontend\index.html` и `web/frontend/src/main.tsx`

Текущая модель Booking уже содержит поля: `id, title, description, start_time, end_time, user_id, workspace_id, room_id, guests (JSONB), recurrence, recurrence_until, recurrence_group_id, recurrence_days, reminder_minutes, notified_at, deleted_at, prev_start_time, prev_end_time`. Связей: User, Workspace, Room.

---

## ЗАДАЧА

Добавить опциональную видеоконференцию на базе **Jitsi Meet**. Пользователь при создании/редактировании брони ставит чекбокс **«Нужна видеоконференция»** — только тогда генерируется уникальная ссылка. Решение должно работать в:
- desktop-браузере (Chrome/Edge/Firefox/Safari)
- мобильном Chrome на Android
- мобильном Safari на iOS

Видеоконференция открывается через **JitsiMeetExternalAPI** с гибридной стратегией: на десктопе iframe-модал внутри приложения, на мобильных — новая вкладка `https://{JITSI_DOMAIN}/{roomName}` (iOS Safari нестабильно работает с iframe-Jitsi из-за permissions policy на камеру/микрофон в кросс-доменном iframe).

Сервер Jitsi: **по умолчанию `meet.jit.si`, но домен и опции конфигурируются через .env** — это даёт путь к self-hosted без переписывания кода.

---

## ТРЕБОВАНИЯ ПО СЛОЯМ

### 1. Backend — модель и миграция

В `app/models/booking.py` к модели `Booking` добавь три nullable-поля:
- `video_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))`
- `video_room_name: Mapped[str | None] = mapped_column(String(128), nullable=True)`
- `video_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)` — на будущее («jitsi», потом могут быть другие)

В `app/main.py` (там, где `ALTER TABLE IF NOT EXISTS` для других колонок) добавь безопасные ALTER-ы:
```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_room_name VARCHAR(128);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_provider VARCHAR(32);
```

### 2. Backend — конфиг

В `app/config.py` добавь в Settings:
- `JITSI_DOMAIN: str = "meet.jit.si"`
- `JITSI_ROOM_PREFIX: str = "corpmeet"` — префикс для названия комнаты
- `JITSI_ENABLED: bool = True` — глобальный флаг, чтобы можно было выключить фичу

В `web/backend/app/.env.example` (создай, если нет) и подробно опиши в комментариях, как переключить на self-hosted.

### 3. Backend — схемы и роутер

В `app/schemas/booking.py`:
- В `BookingCreate` и `BookingUpdate` добавь поле `video_enabled: bool = False`.
- В `BookingResponse` добавь:
  - `video_enabled: bool`
  - `video_url: str | None = None` (вычисляется на сервере)
  - `video_room_name: str | None = None`

В `app/api/v1/bookings.py`:
- В обработчике POST `/api/v1/bookings` после создания записи, если `payload.video_enabled is True`, сгенерируй `video_room_name` по шаблону `f"{settings.JITSI_ROOM_PREFIX}-{booking.id}-{secrets.token_urlsafe(8)}"` (только `[A-Za-z0-9_-]`, без пробелов), сохрани в БД и установи `video_provider="jitsi"`. Если `video_enabled is False` — оставь поля `NULL`.
- В обработчике PATCH `/api/v1/bookings/{id}`: если `video_enabled` меняется с `False → True` — генерируй room_name; если `True → False` — обнуляй room_name и provider. Не пересоздавай существующую комнату при повторном PATCH с тем же `True`.
- В сериализации ответа добавь вычисляемое поле `video_url` = `f"https://{settings.JITSI_DOMAIN}/{video_room_name}"` если `video_room_name` не пустой. Если `JITSI_ENABLED=False`, фронт всё равно должен видеть флаг, но `video_url` верни `None` и в логи пиши предупреждение.
- При повторяющихся бронированиях (recurrence) — **каждая** инстанция получает свою уникальную комнату (название содержит `booking.id`, поэтому делается автоматически в цикле создания).

В `app/api/v1/bookings.py` для `GET /api/v1/internal/bookings/reminders` (если эндпоинт там) — убедись, что в ответе бот получает `video_url` и `video_enabled`.

### 4. Frontend — типы и API-клиент

В `web/frontend/src/types/index.ts` в интерфейсы `Booking`, `BookingCreate`, `BookingUpdate` добавь:
- `video_enabled: boolean`
- `video_url?: string | null`
- `video_room_name?: string | null`

В `web/frontend/src/api/bookings.ts` ничего менять не нужно — поля проходят прозрачно через axios. Но проверь, что в `BookingCreate`/`BookingUpdate` маппинге ничего не отфильтровывает `video_enabled`.

### 5. Frontend — форма бронирования

В `web/frontend/src/components/Dashboard/BookingModal.tsx`:
- Добавь в локальный state поле `videoEnabled: boolean` (по умолчанию `false`, либо `booking.video_enabled` при редактировании).
- Добавь UI-чекбокс **«Нужна видеоконференция»** в логически разумном месте формы (после полей времени, перед гостями/вложениями). Стиль — Tailwind, согласуй с существующими чекбоксами в форме (повторение).
- Под чекбоксом, если включён И мы в режиме редактирования существующей брони с `video_url`, показывай маленький блок «Ссылка готова: …» с кнопкой «Копировать». При создании новой брони (id нет) показывай подсказку «Ссылка будет создана после сохранения».
- В payload отправки добавь `video_enabled: videoEnabled`.
- Не блокируй сабмит, если `videoEnabled === false` — это валидный кейс.

### 6. Frontend — отображение и подключение к встрече

В `web/frontend/src/components/Calendar/BookingCard.tsx` (и, если есть отдельный `BookingDetails`/похожий компонент списка):
- Если `booking.video_enabled && booking.video_url`, показывай кнопку **«Подключиться к встрече»** (иконка камеры из используемой библиотеки иконок, проверь package.json — там может быть lucide-react или heroicons).
- При клике — определяй тип устройства:
  ```ts
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  ```
  - Если **mobile** → `window.open(booking.video_url, '_blank', 'noopener,noreferrer')`.
  - Если **desktop** → открывай новый компонент `<JitsiMeetModal roomName={...} displayName={user.name} domain={JITSI_DOMAIN} onClose={...} />`.

Создай новый компонент `web/frontend/src/components/Video/JitsiMeetModal.tsx`:
- Использует `JitsiMeetExternalAPI` через CDN-скрипт `https://{domain}/external_api.js` (домен берётся из переменной окружения Vite — добавь `VITE_JITSI_DOMAIN` в `.env.example` фронта).
- Скрипт лениво подгружается через динамический `<script>`-тег при первом монтировании модала, кешируется глобально.
- Полноэкранный модал (z-index выше всего), кнопка «Закрыть» в углу. На мобильном вьюпорте — на всю высоту экрана (но мобильные мы туда не пускаем, это fallback).
- В параметрах конфигурации Jitsi:
  ```js
  const options = {
    roomName,
    parentNode: containerRef.current,
    userInfo: { displayName: userName },
    width: '100%',
    height: '100%',
    configOverwrite: {
      prejoinPageEnabled: true,
      disableDeepLinking: true,  // не предлагать установку мобильного приложения
    },
    interfaceConfigOverwrite: {
      MOBILE_APP_PROMO: false,
    },
  };
  const api = new window.JitsiMeetExternalAPI(domain, options);
  api.addEventListener('readyToClose', onClose);
  ```
- При unmount компонента: `api.dispose()`.

В `web/frontend/index.html` НЕ добавляй внешний скрипт глобально — лучше грузить лениво из модала, чтобы не платить за загрузку пользователям без видеовстреч.

### 7. Bot — уведомления и напоминания

В `web/backend/app/bot/tasks/notifications.py`:
- В сообщение подтверждения брони добавляй блок (только если `booking.video_url`):
  ```
  🎥 Видеоконференция: {video_url}
  ```
- В сообщение отмены брони — упомянуть, что встреча отменена.

В `web/backend/app/bot/tasks/reminders.py`:
- В тексте напоминания за 15 минут добавь кликабельную ссылку «Подключиться» (если `video_url` есть). Telegram автоматически делает URL-ы кликабельными, либо используй HTML/Markdown parse_mode, как уже сделано в существующих сообщениях.
- Эндпоинт `GET /api/v1/internal/bookings/reminders` уже должен возвращать `video_url` (см. пункт 3) — подтверди, что бот достаёт это поле.

### 8. iCalendar feed

В обработчике `GET /api/v1/bookings/feed/{feed_token}`:
- В VEVENT добавь поле `LOCATION` с физической комнатой (если уже не добавлено) И параллельно `URL:{video_url}` или строку в DESCRIPTION с ссылкой на Jitsi. Это нужно, чтобы Google Calendar/Apple Calendar показывали кнопку «Присоединиться».
- Формат: добавь в DESCRIPTION строку `\\nВидеоконференция: {video_url}` (escape согласно RFC 5545 — переносы строк через `\\n`, экранирование запятых/точек с запятой).

### 9. CORS

В `app/main.py` в список разрешённых origins для CORS — НИЧЕГО добавлять не нужно: Jitsi не делает запросов к нашему backend. Скрипт `external_api.js` грузится с домена Jitsi на нашем фронте — это работает по обычным правилам загрузки скриптов, CORS тут не вмешивается.

Но `Permissions-Policy` заголовок ответа фронта (если в nginx/Vite preview настроен `Feature-Policy`/`Permissions-Policy`) НЕ должен запрещать `camera`, `microphone`, `display-capture`. Проверь nginx-конфиг (если есть в `web/frontend` или `docker-compose`) и убедись, что либо заголовок не выставлен, либо включает разрешения для камеры/микрофона на нашем origin.

### 10. Telegram Mini App совместимость

Если приложение открывается внутри Telegram Mini App (см. `useTelegramWebApp` хуки или похожее в коде фронта) — на мобильных Telegram Mini App ЛУЧШЕ открывать Jitsi через `Telegram.WebApp.openLink(url, { try_instant_view: false })` вместо `window.open`, иначе iOS блокирует popups. Проверь, есть ли в коде утилита для определения, что мы внутри TMA, и используй её для выбора правильного метода открытия.

---

## ACCEPTANCE CRITERIA

1. Создаю бронь БЕЗ галочки → в БД `video_enabled=false`, `video_room_name=NULL`. В UI карточки — нет кнопки «Подключиться».
2. Создаю бронь С галочкой → в БД `video_enabled=true`, уникальный `video_room_name`. В ответе API есть `video_url`. В UI — кнопка «Подключиться».
3. Снимаю галочку в существующей брони → `video_room_name` обнуляется, кнопка исчезает.
4. Ставлю галочку у существующей брони, которая создавалась без неё → генерируется room_name, кнопка появляется.
5. На десктопе нажатие «Подключиться» открывает Jitsi в iframe-модале (внутри страницы).
6. На мобильном (User-Agent содержит Android/iPhone/iPad) — открывается новая вкладка `https://meet.jit.si/{roomName}`. На iOS Safari запрашиваются разрешения на камеру/микрофон, и встреча работает.
7. В Telegram-сообщении подтверждения и в напоминании за 15 минут есть кликабельная ссылка.
8. iCalendar feed содержит ссылку в DESCRIPTION.
9. Переменная окружения `JITSI_DOMAIN` позволяет переключиться на self-hosted без правки кода.
10. Существующие брони (без видео) после миграции продолжают корректно работать — поле `video_enabled` дефолтится в `false`.

---

## ПОРЯДОК РЕАЛИЗАЦИИ

Делай по шагам, после каждого шага самопроверка через чтение получившегося файла:

1. Модель + миграция в main.py (бэк).
2. Конфиг + .env.example (бэк).
3. Схемы Pydantic (бэк).
4. Роутер `/bookings` — POST/PATCH (бэк).
5. iCalendar feed (бэк).
6. Эндпоинт reminders (бэк).
7. Запусти бэкенд локально (`docker compose up backend db` или как принято в проекте), убедись что миграции отрабатывают, схемы валидны.
8. TS-типы (фронт).
9. BookingModal — чекбокс (фронт).
10. JitsiMeetModal — новый компонент (фронт).
11. BookingCard — кнопка «Подключиться» с детектом устройства (фронт).
12. Запусти фронт (`docker compose up frontend` или `npm run dev`), вручную проверь acceptance criteria 1–6.
13. Бот: notifications.py, reminders.py.
14. Финальная проверка acceptance criteria 7–10.

---

## ОГРАНИЧЕНИЯ

- НЕ устанавливай `lib-jitsi-meet` как npm-зависимость — это низкоуровневая библиотека для построения собственного Jitsi-клиента, она НЕ нужна. Используй только `JitsiMeetExternalAPI` (тонкий iframe-wrapper, грузится скриптом с домена Jitsi).
- НЕ ломай существующий поток создания брони — `video_enabled` строго опционален и по умолчанию `false`.
- НЕ добавляй Alembic — следуй существующему паттерну авто-ALTER в `main.py`.
- НЕ генерируй JWT для Jitsi (это нужно только для self-hosted с авторизацией; для `meet.jit.si` токен не требуется). Если в будущем понадобится — оставь TODO-комментарий в роутере.
- При выборе имени комнаты — никаких пробелов, эмодзи, юникода. Только `[A-Za-z0-9_-]`, длина 16–80 символов.

---

## ЕСЛИ ВСТРЕТИТСЯ НЕОЖИДАННОЕ

- Если в `BookingModal.tsx` нет очевидного места для чекбокса — добавь его после полей даты/времени, оформлением повторяя ближайший существующий toggle.
- Если в проекте уже есть утилита определения мобильного устройства — используй её вместо `navigator.userAgent`-регекспа.
- Если структура иконок другая (не lucide-react) — возьми любую существующую «видео»-иконку из проекта.

Когда закончишь — отчитайся коротким списком изменённых файлов и подтверди, что каждый пункт acceptance criteria проверен.
