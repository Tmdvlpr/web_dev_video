# Промпт: собственный видеосервис для CorpMeet (LiveKit self-hosted, до 100 участников)

> Скопируй этот промпт целиком и отправь Claude Code / другому LLM-агенту с правами на правку файлов в `C:\Users\Timur\Desktop\kod\Work\tg_3_meet`. Промпт самодостаточный.

---

## КОНТЕКСТ ПРОЕКТА

Ты дорабатываешь **CorpMeet** — корпоративную систему бронирования переговорок. Корень: `C:\Users\Timur\Desktop\kod\Work\tg_3_meet`.

**Стек:**
- Backend: Python 3.11 + FastAPI 0.111 + SQLAlchemy 2.0 (async) + asyncpg + PostgreSQL 16. Папка `web/backend`. Pydantic v2. PASETO-аутентификация (НЕ JWT для пользовательских сессий — там PASETO).
- Frontend: React 18.3 + TypeScript 5.4 + Vite 5 + Tailwind 3.4 + TanStack Query 5 + axios + Framer Motion. Папка `web/frontend`.
- Bot: aiogram 3.10+ внутри backend (`web/backend/app/bot`), дёргает внутренние API с заголовком `X-Bot-Secret`.
- Миграций Alembic НЕТ — схема правится через безопасные `CREATE TABLE/ALTER TABLE IF NOT EXISTS` в `app/main.py` (lifespan startup). Следуй существующему паттерну.
- Docker: `docker-compose.yml` в корне, сервисы `db` (5433), `backend` (8050), `frontend` (3050). Сеть 172.28.0.0/16.

**Ключевые файлы (используй абсолютные пути, обязательно читай через Read перед правкой):**
- Модель Booking: `web/backend/app/models/booking.py`
- Схемы Pydantic: `web/backend/app/schemas/booking.py`
- Роутер бронирований: `web/backend/app/api/v1/bookings.py`
- Главный файл + автомиграции: `web/backend/app/main.py`
- Конфиг (pydantic-settings): `web/backend/app/config.py`
- .env backend: `web/backend/app/.env`
- TS-типы: `web/frontend/src/types/index.ts`
- API-клиент бронирований: `web/frontend/src/api/bookings.ts`
- Форма создания/редактирования брони: `web/frontend/src/components/Dashboard/BookingModal.tsx`
- Карточка брони: `web/frontend/src/components/Calendar/BookingCard.tsx`
- Reminders бота: `web/backend/app/bot/tasks/reminders.py`
- Notifications бота: `web/backend/app/bot/tasks/notifications.py`
- Входная точка фронта: `web/frontend/index.html`, `web/frontend/src/main.tsx`

Текущие поля Booking: `id, title, description, start_time, end_time, user_id, workspace_id, room_id, guests (JSONB), recurrence, recurrence_until, recurrence_group_id, recurrence_days, reminder_minutes, notified_at, deleted_at, prev_start_time, prev_end_time`.

---

## ЗАДАЧА

Реализовать **собственный видеосервис** для встреч. Требования заказчика:
1. **Никаких сторонних SaaS** — медиа и сигналлинг ТОЛЬКО на наших серверах.
2. **Все метаданные в нашей PostgreSQL** — комнаты, участники, история, чат, метаданные записей.
3. **Опционально через чекбокс «Нужна видеоконференция»** при создании/редактировании брони — без галочки видеосервиса нет.
4. **Запас по нагрузке до 100 одновременных пользователей** (несколько встреч параллельно, до 20–30 в одной комнате).
5. **Работает во всех браузерах** — Chrome/Edge/Firefox/Safari на десктопе, мобильный Chrome на Android, мобильный Safari на iOS.

**Архитектурное решение — self-hosted LiveKit:**
- LiveKit — open-source SFU (Apache 2.0) на Go, горизонтально масштабируется, поддерживает Simulcast и Dynacast (адаптивный битрейт под слабые устройства).
- Развёртывается отдельным контейнером в нашем `docker-compose.yml`. Медиа-трафик идёт через наш сервер.
- FastAPI выдаёт JWT-токены доступа к комнатам (это служебные токены LiveKit, не путать с пользовательской PASETO-сессией).
- Frontend использует `@livekit/components-react` — нативная интеграция в наше React-приложение, никаких iframe.
- Чат сообщения встречи идут через **наш FastAPI WebSocket** и пишутся в PostgreSQL (не через LiveKit data channels), чтобы история была в нашей БД.
- LiveKit Webhooks (`participant_joined`, `participant_left`, `room_started`, `room_finished`) шлются на наш backend для логирования в БД.
- (Опционально, во вторую очередь) — `livekit-egress` для записи встреч в mp4 на диск сервера; путь и метаданные в PostgreSQL.

**Почему именно LiveKit, а не Jitsi:**
- Лучше масштабируется на 100+ участников (Go vs Java, меньше памяти).
- Официальный Python SDK (`livekit-api`) и React-компоненты (`@livekit/components-react`) — встраивается нативно, не iframe.
- Простая модель «токен → комната» без громоздкого XMPP/Prosody/Jicofo.
- Apache 2.0, без вендор-лока.

---

## ИНФРАСТРУКТУРА

### 1. docker-compose.yml — добавить два сервиса

В корневой `docker-compose.yml` добавь:

```yaml
  livekit:
    image: livekit/livekit-server:latest
    container_name: corpmeet-livekit
    restart: unless-stopped
    command: --config /etc/livekit.yaml
    volumes:
      - ./infra/livekit/livekit.yaml:/etc/livekit.yaml:ro
    ports:
      - "7880:7880"        # WebSocket signaling
      - "7881:7881"        # TCP fallback для WebRTC
      - "7882:7882/udp"    # UDP TURN
      # Диапазон RTC UDP-портов (только в host-режиме либо мапить иначе)
    environment:
      - LIVEKIT_KEYS=${LIVEKIT_API_KEY}:${LIVEKIT_API_SECRET}
    networks:
      - corpmeet-net
    deploy:
      resources:
        limits:
          cpus: "4"
          memory: 4G

  livekit-egress:
    image: livekit/egress:latest
    container_name: corpmeet-livekit-egress
    restart: unless-stopped
    environment:
      - EGRESS_CONFIG_FILE=/etc/egress.yaml
    volumes:
      - ./infra/livekit/egress.yaml:/etc/egress.yaml:ro
      - ./data/recordings:/out
    networks:
      - corpmeet-net
    depends_on:
      - livekit
    cap_add:
      - SYS_ADMIN  # нужно для запуска headless Chrome
```

**Важно:** для прода **обязательно** UDP-трафик на 50000–60000 (RTC range), иначе клиенты с симметричными NAT не смогут подключиться. Либо запускай LiveKit в `network_mode: host` на проде, либо явно мапь диапазон. В dev-режиме (одна машина) `network_mode: host` проще всего.

### 2. Конфиг LiveKit — `infra/livekit/livekit.yaml`

Создай новый файл:

```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  # подставится из ENV LIVEKIT_KEYS, но можно прописать тут (НЕ коммить!)
webhook:
  api_key: ${LIVEKIT_API_KEY}
  urls:
    - http://backend:8050/api/v1/internal/livekit/webhook
room:
  empty_timeout: 300        # комната закрывается через 5 мин после ухода последнего
  max_participants: 50      # запас: одна встреча — до 50, всего сервер тянет ~100
logging:
  level: info
turn:
  enabled: true
  domain: localhost         # на проде — реальный домен с TLS
  tls_port: 5349
  udp_port: 3478
```

### 3. `.env` и `.env.example` backend

В `web/backend/app/.env` (и в новый `.env.example` рядом, который коммитится в git без секретов):

```
# === Video service (LiveKit) ===
LIVEKIT_API_KEY=APIxxxxxxxxxxxx
LIVEKIT_API_SECRET=secret_at_least_32_chars_long_xxxxx
LIVEKIT_HOST=ws://livekit:7880        # для backend (внутри docker-сети)
LIVEKIT_PUBLIC_URL=ws://localhost:7880 # для фронта; на проде — wss://livekit.your-domain
LIVEKIT_WEBHOOK_SECRET=               # = LIVEKIT_API_SECRET (LiveKit подписывает webhook этим ключом)
VIDEO_ENABLED=true
VIDEO_MAX_PARTICIPANTS=50
VIDEO_RECORDING_ENABLED=false         # включить позже, во вторую очередь
```

Сгенерируй надёжные значения: `LIVEKIT_API_KEY=API` + 12 случайных байт base64, `LIVEKIT_API_SECRET` — минимум 32 символа.

### 4. `web/frontend/.env.example`

```
VITE_LIVEKIT_URL=ws://localhost:7880
```

На проде = `wss://livekit.your-domain` за TLS-реверс-прокси (nginx/caddy).

---

## BACKEND — РЕАЛИЗАЦИЯ

### 5. Зависимости — `web/backend/requirements.txt`

Добавь:
```
livekit-api>=0.8.0
livekit>=0.16.0
```

### 6. Конфиг — `web/backend/app/config.py`

В `Settings` добавь:
```python
LIVEKIT_API_KEY: str = ""
LIVEKIT_API_SECRET: str = ""
LIVEKIT_HOST: str = "ws://livekit:7880"          # внутренний URL (для backend-side вызовов)
LIVEKIT_PUBLIC_URL: str = "ws://localhost:7880"  # отдаём фронту
LIVEKIT_WEBHOOK_SECRET: str = ""                 # совпадает с LIVEKIT_API_SECRET
VIDEO_ENABLED: bool = True
VIDEO_MAX_PARTICIPANTS: int = 50
VIDEO_RECORDING_ENABLED: bool = False
```

### 7. Модели и миграции — `web/backend/app/models/`

#### 7.1. В `booking.py` добавь к `Booking`:
```python
video_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
video_room_name: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True, index=True)
```

#### 7.2. Создай новый файл `web/backend/app/models/meeting.py` с тремя моделями:

```python
class MeetingSession(Base):
    """Сессия встречи — фактическое включение Jitsi/LiveKit-комнаты.
    Одна бронь может иметь много сессий (например, если люди заходили дважды)."""
    __tablename__ = "meeting_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True)
    room_name: Mapped[str] = mapped_column(String(128), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recording_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    recording_duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

class MeetingParticipantLog(Base):
    """Лог: кто и когда подключался к комнате (из LiveKit webhooks)."""
    __tablename__ = "meeting_participant_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("meeting_sessions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    participant_identity: Mapped[str] = mapped_column(String(128))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class MeetingChatMessage(Base):
    """Чат внутри встречи — пишем в нашу БД, не через LiveKit data channel."""
    __tablename__ = "meeting_chat_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
```

#### 7.3. В `web/backend/app/main.py` в блок автомиграций добавь:

```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_room_name VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS ix_bookings_video_room_name ON bookings(video_room_name) WHERE video_room_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS meeting_sessions (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_name VARCHAR(128) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  recording_path VARCHAR(512),
  recording_duration_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS ix_meeting_sessions_booking ON meeting_sessions(booking_id);
CREATE INDEX IF NOT EXISTS ix_meeting_sessions_room ON meeting_sessions(room_name);

CREATE TABLE IF NOT EXISTS meeting_participant_logs (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  participant_identity VARCHAR(128) NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_mpl_session ON meeting_participant_logs(session_id);
CREATE INDEX IF NOT EXISTS ix_mpl_user ON meeting_participant_logs(user_id);

CREATE TABLE IF NOT EXISTS meeting_chat_messages (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_mcm_booking ON meeting_chat_messages(booking_id);
CREATE INDEX IF NOT EXISTS ix_mcm_created ON meeting_chat_messages(created_at);
```

### 8. Сервисный слой — `web/backend/app/services/video.py`

Создай новый модуль:

```python
import secrets, time
from livekit import api as lk_api
from app.config import settings

def generate_room_name(booking_id: int) -> str:
    return f"corpmeet-{booking_id}-{secrets.token_urlsafe(8)}"

def create_access_token(*, room_name: str, user_id: int, user_name: str, can_publish: bool = True) -> str:
    """Выдаёт LiveKit JWT-токен для входа в комнату."""
    grants = lk_api.VideoGrants(
        room=room_name,
        room_join=True,
        can_publish=can_publish,
        can_subscribe=True,
        can_publish_data=True,
    )
    token = (
        lk_api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        .with_identity(f"user-{user_id}")
        .with_name(user_name)
        .with_grants(grants)
        .with_ttl(timedelta(hours=4))  # время жизни токена
    )
    return token.to_jwt()

async def ensure_room_exists(room_name: str, max_participants: int) -> None:
    """Создаёт комнату на LiveKit (идемпотентно)."""
    lkapi = lk_api.LiveKitAPI(
        url=settings.LIVEKIT_HOST.replace("ws://", "http://").replace("wss://", "https://"),
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    )
    try:
        await lkapi.room.create_room(lk_api.CreateRoomRequest(
            name=room_name,
            empty_timeout=300,
            max_participants=max_participants,
        ))
    finally:
        await lkapi.aclose()

def verify_webhook(body: bytes, auth_header: str) -> dict:
    """Проверяет подпись webhook от LiveKit и возвращает payload."""
    token_verifier = lk_api.TokenVerifier(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    webhook_receiver = lk_api.WebhookReceiver(token_verifier)
    return webhook_receiver.receive(body.decode(), auth_header)
```

### 9. Pydantic-схемы — `web/backend/app/schemas/booking.py`

В `BookingCreate` и `BookingUpdate` добавь:
```python
video_enabled: bool = False
```

В `BookingResponse` добавь:
```python
video_enabled: bool
video_room_name: str | None = None
```

Создай `web/backend/app/schemas/meeting.py`:
```python
class MeetingJoinResponse(BaseModel):
    room_name: str
    livekit_url: str
    access_token: str
    user_identity: str

class ChatMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)

class ChatMessageResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    body: str
    created_at: datetime
```

### 10. Роутер бронирований — `web/backend/app/api/v1/bookings.py`

В `POST /api/v1/bookings`:
- Если `payload.video_enabled is True` → сгенерируй `room_name` через `generate_room_name(booking.id)`, сохрани в `booking.video_room_name`, асинхронно вызови `ensure_room_exists(...)`. При ошибке создания комнаты на LiveKit — НЕ откатывай бронь, только пиши ошибку в логи (LiveKit может быть временно недоступен, комната всё равно создастся при первом джойне). Если `False` — `video_room_name = None`.

В `PATCH /api/v1/bookings/{id}`:
- Переход `False → True`: генерируй room_name, ensure_room_exists.
- Переход `True → False`: обнуляй room_name (комнату на LiveKit удалять не обязательно — она протухнет через empty_timeout).
- При повторном `True → True` ничего не делать.

### 11. Новый роутер встреч — `web/backend/app/api/v1/meetings.py`

```python
router = APIRouter(prefix="/api/v1/meetings", tags=["meetings"])

@router.post("/{booking_id}/join", response_model=MeetingJoinResponse)
async def join_meeting(booking_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    booking = await db.get(Booking, booking_id)
    if not booking or booking.deleted_at:
        raise HTTPException(404, "Booking not found")
    # Проверка прав: пользователь — создатель ИЛИ есть в guests ИЛИ член workspace
    if not user_can_access_booking(booking, user):
        raise HTTPException(403, "Forbidden")
    if not booking.video_enabled or not booking.video_room_name:
        raise HTTPException(400, "Video conference is not enabled for this booking")
    # Проверка временного окна: не раньше чем за 10 минут до начала, не позже чем через 2 часа после конца
    now = datetime.now(timezone.utc)
    if now < booking.start_time - timedelta(minutes=10):
        raise HTTPException(403, "Meeting has not started yet")
    if now > booking.end_time + timedelta(hours=2):
        raise HTTPException(403, "Meeting is over")
    await ensure_room_exists(booking.video_room_name, settings.VIDEO_MAX_PARTICIPANTS)
    token = create_access_token(
        room_name=booking.video_room_name,
        user_id=user.id,
        user_name=user.full_name or user.username or f"user-{user.id}",
    )
    return MeetingJoinResponse(
        room_name=booking.video_room_name,
        livekit_url=settings.LIVEKIT_PUBLIC_URL,
        access_token=token,
        user_identity=f"user-{user.id}",
    )

@router.get("/{booking_id}/chat", response_model=list[ChatMessageResponse])
async def get_chat_history(booking_id: int, ...):
    # SELECT * FROM meeting_chat_messages WHERE booking_id = ... ORDER BY created_at LIMIT 500

@router.post("/{booking_id}/chat", response_model=ChatMessageResponse)
async def post_chat_message(booking_id: int, payload: ChatMessageCreate, ...):
    # INSERT в meeting_chat_messages, бродкаст через WebSocket подписчикам

@router.websocket("/{booking_id}/chat/ws")
async def chat_ws(websocket: WebSocket, booking_id: int):
    # Аутентификация: токен в query params (?token=...)
    # ConnectionManager — словарь booking_id → set[WebSocket]
    # При новом сообщении: парсим, валидируем, INSERT в БД, broadcast всем подписчикам комнаты
```

Зарегистрируй роутер в `app/main.py`.

### 12. Webhook от LiveKit — внутренний эндпоинт

В существующем `app/api/v1/internal/...` (или создай новый файл `app/api/v1/internal/livekit.py`):

```python
@router.post("/livekit/webhook")
async def livekit_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    body = await request.body()
    try:
        event = verify_webhook(body, auth)
    except Exception:
        raise HTTPException(401, "Invalid signature")

    event_type = event.get("event")
    room = event.get("room", {})
    participant = event.get("participant", {})
    room_name = room.get("name")
    if not room_name:
        return {"ok": True}

    if event_type == "room_started":
        booking = await find_booking_by_room(db, room_name)
        if booking:
            db.add(MeetingSession(booking_id=booking.id, room_name=room_name))
            await db.commit()
    elif event_type == "room_finished":
        session = await find_active_session(db, room_name)
        if session:
            session.ended_at = datetime.now(timezone.utc)
            await db.commit()
    elif event_type == "participant_joined":
        session = await find_active_session(db, room_name)
        if session:
            identity = participant.get("identity", "")
            user_id = int(identity.split("-")[1]) if identity.startswith("user-") else None
            db.add(MeetingParticipantLog(session_id=session.id, user_id=user_id, participant_identity=identity))
            await db.commit()
    elif event_type == "participant_left":
        # UPDATE meeting_participant_logs SET left_at = NOW() WHERE session_id = ... AND identity = ... AND left_at IS NULL
        ...
    return {"ok": True}
```

Этот эндпоинт открыт для контейнера livekit, аутентификация — через подпись в Authorization (TokenVerifier из livekit-api). НЕ закрывай его X-Bot-Secret и НЕ требуй PASETO.

### 13. CORS — `app/main.py`

В список allowed origins НИЧЕГО добавлять не нужно — LiveKit подключается напрямую с фронта по WebSocket, не через наш backend.

Но в **CSP** (Content-Security-Policy), если он выставлен в nginx/Vite-preview/middleware, добавь:
- `connect-src` — `${VITE_LIVEKIT_URL}` (ws://livekit:7880 или wss://livekit.your-domain)
- `media-src 'self' blob:`

И заголовок `Permissions-Policy` НЕ должен запрещать `camera`, `microphone`, `display-capture` для нашего origin.

---

## FRONTEND — РЕАЛИЗАЦИЯ

### 14. NPM-зависимости — `web/frontend/package.json`

```bash
npm install @livekit/components-react @livekit/components-styles livekit-client
```

### 15. TS-типы — `web/frontend/src/types/index.ts`

В `Booking`, `BookingCreate`, `BookingUpdate`:
```ts
video_enabled: boolean;
video_room_name?: string | null;
```

### 16. API-клиент встреч — `web/frontend/src/api/meetings.ts`

```ts
export const meetingsApi = {
  join: (bookingId: number) =>
    axios.post<MeetingJoinResponse>(`/api/v1/meetings/${bookingId}/join`).then(r => r.data),
  getChatHistory: (bookingId: number) =>
    axios.get<ChatMessage[]>(`/api/v1/meetings/${bookingId}/chat`).then(r => r.data),
  sendChatMessage: (bookingId: number, body: string) =>
    axios.post<ChatMessage>(`/api/v1/meetings/${bookingId}/chat`, { body }).then(r => r.data),
};
```

### 17. Чекбокс в форме — `BookingModal.tsx`

В компонент `BookingModal.tsx`:
- Локальный state: `const [videoEnabled, setVideoEnabled] = useState(booking?.video_enabled ?? false);`
- В UI после полей даты/времени, перед гостями, добавь Tailwind-чекбокс «Нужна видеоконференция» (стилистически согласуй с другими чекбоксами в форме).
- В payload отправки: `video_enabled: videoEnabled`.
- При редактировании, если `booking.video_room_name` уже есть, под чекбоксом покажи небольшую плашку «Видеокомната готова», без явного показа URL (URL не светим без необходимости — комната работает по токену, а не по угадыванию имени).

### 18. Компонент комнаты — `web/frontend/src/components/Video/MeetingRoom.tsx`

Новый компонент, использует `@livekit/components-react`:

```tsx
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  ControlBar,
  useTracks,
  GridLayout,
  ParticipantTile,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import { useQuery } from '@tanstack/react-query';

export function MeetingRoom({ bookingId, onLeave }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['meeting-join', bookingId],
    queryFn: () => meetingsApi.join(bookingId),
    retry: false,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorView error={error} />;
  if (!data) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black">
      <LiveKitRoom
        token={data.access_token}
        serverUrl={data.livekit_url}
        connect={true}
        video={true}
        audio={true}
        onDisconnected={onLeave}
        data-lk-theme="default"
        style={{ height: '100vh' }}
      >
        <VideoConference />
        <RoomAudioRenderer />
        {/* Кастомная панель чата справа — отдельным портал-оверлеем, см. ниже */}
        <MeetingChatPanel bookingId={bookingId} />
      </LiveKitRoom>
    </div>
  );
}
```

Компонент **полностью встроен в наше приложение**, никаких iframe. Управление микрофоном/камерой/демонстрацией экрана — стандартный `<ControlBar />` из `@livekit/components-react`.

### 19. Чат-панель — `web/frontend/src/components/Video/MeetingChatPanel.tsx`

Чат идёт через **наш FastAPI WebSocket**, не через LiveKit data channels — чтобы вся история сохранялась в нашей БД:

```tsx
export function MeetingChatPanel({ bookingId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // 1. Подгрузить историю
    meetingsApi.getChatHistory(bookingId).then(setMessages);
    // 2. Открыть WS
    const token = getAuthToken();
    const ws = new WebSocket(
      `${import.meta.env.VITE_API_URL.replace(/^http/, 'ws')}/api/v1/meetings/${bookingId}/chat/ws?token=${token}`
    );
    ws.onmessage = (e) => setMessages(prev => [...prev, JSON.parse(e.data)]);
    wsRef.current = ws;
    return () => ws.close();
  }, [bookingId]);

  // UI: панель справа, Tailwind, input + кнопка отправить, отправка через wsRef.current.send(JSON.stringify({ body }))
}
```

### 20. Кнопка «Подключиться» — `BookingCard.tsx`

В `web/frontend/src/components/Calendar/BookingCard.tsx`:
- Если `booking.video_enabled`, показывай кнопку «Подключиться к встрече» (иконка камеры — используй ту же библиотеку иконок, что и остальной проект).
- Доступность: enable кнопку только в окне `[start - 10min, end + 2h]` (тот же чек, что и в backend).
- При клике — открывай `<MeetingRoom bookingId={booking.id} onLeave={...} />` как полноэкранный оверлей.
- НЕ нужно определять мобильное устройство — LiveKit-клиент работает в браузерах iOS Safari / Android Chrome нативно (WebRTC поддерживается). Единственное условие — сайт должен быть на **HTTPS** в проде (иначе `getUserMedia` не даст доступ к камере). В dev на `localhost` работает по HTTP.

### 21. Мобильные нюансы

- iOS Safari требует **user gesture** (клик/тап) перед `getUserMedia`. Клик по кнопке «Подключиться» — это и есть user gesture, всё ок.
- На iOS не работает фоновый звук, если пользователь свернул вкладку. Это особенность Safari, не баг — учитывай в UX (показывай предупреждение).
- На Android Chrome всё работает «из коробки».
- В Telegram Mini App встроенный WebView **не** даёт прав на камеру/микрофон стабильно — кнопка «Подключиться» в TMA должна открывать встречу в **системном браузере** через `Telegram.WebApp.openLink(url, { try_instant_view: false })`, где `url` — отдельный маршрут `/meeting/{bookingId}` в нашем фронте. Проверь, есть ли в проекте утилита для определения TMA-режима, и используй её.

---

## BOT — УВЕДОМЛЕНИЯ

### 22. notifications.py и reminders.py

В сообщения подтверждения и напоминания за 15 минут добавляй блок (только если `video_enabled=true`):

```
🎥 Видеоконференция: https://app.your-domain/meeting/{booking_id}
```

URL ведёт на наш фронт, не на LiveKit напрямую — пользователь сначала аутентифицируется в нашем приложении, получает токен через `/meetings/{id}/join`, и только потом видит видеоинтерфейс. **Никогда не отправляй сам LiveKit-токен в Telegram** — он действителен 4 часа и даёт прямой доступ к комнате.

Эндпоинт `GET /api/v1/internal/bookings/reminders` пусть возвращает `video_enabled` и `booking.id` — бот сам соберёт URL.

---

## iCalendar FEED

### 23. В обработчике `GET /api/v1/bookings/feed/{feed_token}`

В VEVENT добавь в DESCRIPTION (если `video_enabled`):
```
\\nВидеоконференция: https://app.your-domain/meeting/{booking.id}
```
И поле `URL:https://app.your-domain/meeting/{booking.id}` — Google Calendar и Apple Calendar тогда отрисуют кнопку «Присоединиться».

---

## ЗАПИСИ ВСТРЕЧ (вторая очередь, не блокирует MVP)

Если `VIDEO_RECORDING_ENABLED=true`:
- При первом `room_started` webhook → backend вызывает livekit-egress API `start_room_composite_egress` с outputs `{ file: { filepath: f"/out/{room_name}-{ts}.mp4" } }`.
- При `room_finished` → backend получает финальный путь от egress, UPDATE `meeting_sessions.recording_path` и `recording_duration_seconds`.
- Добавь эндпоинт `GET /api/v1/meetings/{booking_id}/recordings` — список с сигнатурами доступа.
- Файлы хранятся в `./data/recordings` на хосте (volume в docker-compose). НЕ пихай в PostgreSQL.

Эту часть **не делай в первой итерации**, оставь TODO в коде.

---

## ACCEPTANCE CRITERIA

1. ✅ Бронь без галочки → `video_enabled=false`, `video_room_name=NULL`, кнопки нет.
2. ✅ Бронь с галочкой → `video_enabled=true`, уникальный room_name. На LiveKit комната создана (или создаётся при первом join).
3. ✅ Снятие галочки в существующей брони → room_name обнуляется.
4. ✅ Кнопка «Подключиться» появляется только в окне `[start-10m, end+2h]`.
5. ✅ Клик по кнопке → запрос на `/meetings/{id}/join`, получение токена, открытие MeetingRoom.
6. ✅ Видео и звук работают в Chrome/Edge/Firefox/Safari на десктопе.
7. ✅ Видео и звук работают в мобильном Chrome (Android) и мобильном Safari (iOS) на HTTPS-домене.
8. ✅ Демонстрация экрана работает на десктопе (на iOS Safari частично — это ограничение платформы).
9. ✅ Чат внутри встречи отправляется через наш WebSocket, сообщения видны в `meeting_chat_messages` в PostgreSQL.
10. ✅ Подключения участников логируются в `meeting_participant_logs` через webhook от LiveKit.
11. ✅ Один сервер LiveKit (4 CPU / 4 GB RAM) выдерживает 100 одновременных пользователей (например, 5 встреч по 20 человек) с включённым Simulcast — без зависаний и битрейта < 600 kbps на участника.
12. ✅ В Telegram-сообщении подтверждения и напоминания за 15 минут есть кликабельная ссылка на нашу страницу встречи (НЕ прямой LiveKit-URL с токеном).
13. ✅ iCalendar feed содержит URL встречи.
14. ✅ Все секреты (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) хранятся только в `.env`, не в коде, не в git.
15. ✅ Существующие брони (без видео) продолжают работать без изменений.

---

## ПОРЯДОК РЕАЛИЗАЦИИ

Делай по шагам, после каждого — самопроверка:

1. **Инфра**: docker-compose.yml + infra/livekit/livekit.yaml + .env. Подними `docker compose up livekit`, проверь `curl http://localhost:7880` (отдаёт 404 — это норма, сервис работает).
2. **БД**: модели + миграции в main.py. Перезапусти backend, убедись что таблицы создались.
3. **Сервис video.py** + конфиг.
4. **Схемы и роутеры**: бронирования (video_enabled), meetings (join + chat).
5. **Webhook от LiveKit**: запусти, спровоцируй room_started через тестовый JWT.
6. **Фронт-типы и API-клиент**.
7. **Чекбокс в BookingModal**.
8. **MeetingRoom компонент** — простейшая версия без чата, только видео.
9. **Кнопка «Подключиться» в BookingCard**. Полное end-to-end тестирование в Chrome.
10. **MeetingChatPanel** через WebSocket.
11. **Тестирование на мобильных** (Android Chrome, iOS Safari) — обязательно HTTPS, dev-туннель типа Cloudflare Tunnel / ngrok.
12. **Бот**: notifications, reminders.
13. **iCalendar feed**.
14. **Нагрузочный тест**: симулируй 100 виртуальных участников через livekit-cli `load-test`. Замерь CPU/RAM на сервере.

---

## ОГРАНИЧЕНИЯ И ВАЖНЫЕ МОМЕНТЫ

- **HTTPS обязателен в проде.** Без TLS на домене `getUserMedia` не работает ни в iOS Safari, ни в Android Chrome. В dev — только `localhost`.
- **TURN-сервер обязателен.** LiveKit-сервер сам умеет в TURN/STUN, но для пользователей за корпоративными NAT нужно открыть UDP-порты 50000–60000 и TCP 7881 на сервере. Если порты закрыты — клиенты будут зависать на «Connecting…».
- **НЕ храни видео в PostgreSQL.** Видео — это файлы, БД — для метаданных. Если кто-то скажет «сохрани видео в blob» — откажи и объясни.
- **НЕ передавай LiveKit-токены в Telegram, email, iCal.** Токены — короткоживущие credentials, утечка = захват комнаты. Делись только ссылкой на нашу страницу встречи.
- **НЕ ставь `lib-jitsi-meet`** — это для Jitsi, мы используем LiveKit.
- **НЕ добавляй Alembic** — следуй существующему паттерну авто-ALTER в `main.py`.
- При генерации room_name — только `[A-Za-z0-9_-]`, длина 16–80 символов.
- LiveKit-комнаты сами протухают через `empty_timeout` (5 минут) — отдельной очистки не нужно.
- В первой итерации НЕ делай запись встреч (egress). Заглушка `VIDEO_RECORDING_ENABLED=false`.

---

## ЕСЛИ ВСТРЕТИТСЯ НЕОЖИДАННОЕ

- Если LiveKit Python SDK (`livekit-api`) даёт другую сигнатуру у `AccessToken` или `LiveKitAPI` — сверься с актуальной версией на PyPI и адаптируй вызовы. Концепция «AccessToken + VideoGrants + JWT» остаётся та же.
- Если в `BookingModal.tsx` уже есть toggle/checkbox для других полей — повтори тот же стиль.
- Если в backend есть существующий ConnectionManager для WebSocket (например, для другой фичи) — переиспользуй его, не пиши второй.
- Если есть проблемы с CORS на WebSocket — добавь `Origin` в whitelist через FastAPI middleware.

Когда закончишь — отчитайся списком изменённых/новых файлов, скриншотами LiveKit-комнаты в Chrome и iOS Safari, и подтверди каждый пункт acceptance criteria.
