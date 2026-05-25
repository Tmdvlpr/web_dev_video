import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import Base, engine
from app.limiter import limiter
from app.api.v1 import auth, bookings, internal, meetings, rooms, slots, submissions, users, workspaces
from app.models import attachment  # noqa: F401  — регистрирует BookingAttachment в metadata
from app.models import workspace as _workspace_models  # noqa: F401
from app.models import room as _room_models  # noqa: F401
from app.models import meeting as _meeting_models  # noqa: F401  — регистрирует video.* в metadata

logger = logging.getLogger(__name__)


async def _cleanup_expired_sessions() -> None:
    """Delete expired and used browser sessions hourly to prevent table bloat."""
    from app.models.browser_session import BrowserSession
    while True:
        await asyncio.sleep(3600)
        try:
            async with AsyncSession(engine) as session:
                await session.execute(
                    delete(BrowserSession).where(
                        BrowserSession.expires_at < datetime.now(timezone.utc)
                    )
                )
                await session.commit()
        except Exception as exc:
            logger.warning(f"Session cleanup failed: {exc}")


async def _cleanup_chat_data() -> None:
    """Delete chat messages and files for meetings that ended > CHAT_RETENTION_DAYS ago."""
    from app.models.meeting import MeetingChatFile, MeetingChatMessage
    from app.models.booking import Booking
    from datetime import timedelta
    from sqlalchemy import select
    while True:
        await asyncio.sleep(3600)
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=settings.CHAT_RETENTION_DAYS)
            async with AsyncSession(engine) as session:
                old_bookings = await session.execute(
                    select(Booking.id).where(Booking.end_time < cutoff, Booking.deleted_at.is_(None))
                )
                old_ids = [row[0] for row in old_bookings.all()]
                if old_ids:
                    await session.execute(
                        delete(MeetingChatMessage).where(MeetingChatMessage.booking_id.in_(old_ids))
                    )
                    await session.execute(
                        delete(MeetingChatFile).where(MeetingChatFile.booking_id.in_(old_ids))
                    )
                    await session.commit()
                    logger.info(f"Chat cleanup: purged data for {len(old_ids)} expired meetings")
        except Exception as exc:
            logger.warning(f"Chat cleanup failed: {exc}")


async def _cleanup_attachment_data() -> None:
    """После окончания встречи обнуляет бинарные данные вложений (запись остаётся)."""
    from app.models.attachment import BookingAttachment
    from app.models.booking import Booking
    from sqlalchemy import select, update
    while True:
        await asyncio.sleep(300)  # каждые 5 минут
        try:
            async with AsyncSession(engine) as session:
                subq = select(Booking.id).where(Booking.end_time < datetime.now(timezone.utc))
                await session.execute(
                    update(BookingAttachment)
                    .where(
                        BookingAttachment.booking_id.in_(subq),
                        BookingAttachment.data != b"",
                    )
                    .values(data=b"")
                )
                await session.commit()
        except Exception as exc:
            logger.warning(f"Attachment cleanup failed: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # ── 1. Миграции БД ────────────────────────────────────────────────────────
    async with engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.DB_SCHEMA}"'))
        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS video"))
        await conn.run_sync(Base.metadata.create_all)
        # Safe migrations — add new columns and tables if missing
        migrations = [
            # users table new columns
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_registered BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
            # Backfill first_name/last_name from legacy name field
            """
            UPDATE users SET
              first_name = TRIM(SPLIT_PART(name, ' ', 1)),
              last_name = NULLIF(TRIM(SPLIT_PART(name, ' ', 2)), ''),
              is_registered = true,
              is_active = true
            WHERE first_name IS NULL AND name IS NOT NULL
            """,
            # bookings table
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS description VARCHAR(2000)",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guests JSONB NOT NULL DEFAULT '[]'",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence VARCHAR(10) NOT NULL DEFAULT 'none'",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_until DATE",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_group_id BIGINT",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_days JSONB NOT NULL DEFAULT '[]'",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
            # browser_sessions table
            """
            CREATE TABLE IF NOT EXISTS browser_sessions (
                id SERIAL PRIMARY KEY,
                token VARCHAR(128) UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                used BOOLEAN NOT NULL DEFAULT false,
                used_at TIMESTAMPTZ,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_browser_sessions_token ON browser_sessions(token)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS feed_token VARCHAR(64) UNIQUE",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS language_code VARCHAR(10)",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS prev_start_time TIMESTAMPTZ",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS prev_end_time TIMESTAMPTZ",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_notified_at TIMESTAMPTZ",
            "ALTER TABLE browser_sessions ALTER COLUMN user_id DROP NOT NULL",
            "ALTER TABLE users ALTER COLUMN name DROP NOT NULL",
            "ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_feed_token ON users(feed_token) WHERE feed_token IS NOT NULL",
            # superadmin role
            "ALTER TYPE role ADD VALUE IF NOT EXISTS 'superadmin'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(255)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS default_reminder_minutes INTEGER NOT NULL DEFAULT 15",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(100)",
            """
            CREATE TABLE IF NOT EXISTS booking_attachments (
                id SERIAL PRIMARY KEY,
                booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
                uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                filename VARCHAR(255) NOT NULL,
                mime_type VARCHAR(128) NOT NULL,
                size INTEGER NOT NULL,
                data BYTEA NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_ba_booking ON booking_attachments(booking_id)",
            # ── Workspaces / Rooms (multi-tenant) ────────────────────────────
            "DO $$ BEGIN CREATE TYPE workspacememberrole AS ENUM ('owner','admin','member'); EXCEPTION WHEN duplicate_object THEN null; END $$",
            "DO $$ BEGIN CREATE TYPE workspacememberstatus AS ENUM ('active','pending'); EXCEPTION WHEN duplicate_object THEN null; END $$",
            "DO $$ BEGIN CREATE TYPE workspaceroomrole AS ENUM ('owner','shared'); EXCEPTION WHEN duplicate_object THEN null; END $$",
            "DO $$ BEGIN CREATE TYPE roomvisibility AS ENUM ('full','busy_only'); EXCEPTION WHEN duplicate_object THEN null; END $$",
            """CREATE TABLE IF NOT EXISTS workspaces (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                slug VARCHAR(60) UNIQUE NOT NULL,
                invite_code VARCHAR(20) UNIQUE NOT NULL,
                timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
                telegram_chat_id BIGINT,
                created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                archived_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS workspace_members (
                id SERIAL PRIMARY KEY,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                pending_username VARCHAR(255),
                role workspacememberrole NOT NULL DEFAULT 'member',
                status workspacememberstatus NOT NULL DEFAULT 'active',
                invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_workspace_member UNIQUE (workspace_id, user_id)
            )""",
            """CREATE TABLE IF NOT EXISTS rooms (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description VARCHAR(500),
                created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                archived_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS workspace_rooms (
                id SERIAL PRIMARY KEY,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                role workspaceroomrole NOT NULL DEFAULT 'owner',
                visibility roomvisibility NOT NULL DEFAULT 'full',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_workspace_room UNIQUE (workspace_id, room_id)
            )""",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL",
            # Seed: create default workspace for all existing users (runs only once)
            """
            DO $$
            DECLARE
                ws_id INTEGER;
                rm_id INTEGER;
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM workspaces LIMIT 1) THEN
                    INSERT INTO workspaces (name, slug, invite_code, timezone)
                    VALUES ('CorpMeet', 'corpmeet', 'CORPMEET01', 'Asia/Tashkent')
                    RETURNING id INTO ws_id;

                    INSERT INTO workspace_members (workspace_id, user_id, role, status)
                    SELECT ws_id, id,
                        CASE WHEN role = 'superadmin' THEN 'owner'::workspacememberrole
                             WHEN role = 'admin' THEN 'admin'::workspacememberrole
                             ELSE 'member'::workspacememberrole END,
                        'active'::workspacememberstatus
                    FROM users WHERE is_active = true
                    ON CONFLICT DO NOTHING;

                    INSERT INTO rooms (name, description)
                    VALUES ('Переговорная', 'Основная переговорная комната')
                    RETURNING id INTO rm_id;

                    INSERT INTO workspace_rooms (workspace_id, room_id, role, visibility)
                    VALUES (ws_id, rm_id, 'owner'::workspaceroomrole, 'full'::roomvisibility);

                    UPDATE bookings SET workspace_id = ws_id, room_id = rm_id WHERE workspace_id IS NULL;
                END IF;
            END $$
            """,
            # ── Video schema & tables ─────────────────────────────────────
            "CREATE SCHEMA IF NOT EXISTS video",
            # Bookings video columns
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_enabled BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_room_name VARCHAR(128)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_bookings_video_room_name ON bookings(video_room_name) WHERE video_room_name IS NOT NULL",
            # video.meeting_sessions
            """CREATE TABLE IF NOT EXISTS video.meeting_sessions (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  room_name VARCHAR(128) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  recording_path VARCHAR(512),
  recording_duration_seconds INTEGER,
  egress_id VARCHAR(128)
)""",
            "CREATE INDEX IF NOT EXISTS ix_meeting_sessions_booking ON video.meeting_sessions(booking_id)",
            "CREATE INDEX IF NOT EXISTS ix_meeting_sessions_room ON video.meeting_sessions(room_name)",
            # video.meeting_participant_logs
            """CREATE TABLE IF NOT EXISTS video.meeting_participant_logs (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES video.meeting_sessions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES public.users(id),
  participant_identity VARCHAR(128) NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ
)""",
            "CREATE INDEX IF NOT EXISTS ix_mpl_session ON video.meeting_participant_logs(session_id)",
            "CREATE INDEX IF NOT EXISTS ix_mpl_user ON video.meeting_participant_logs(user_id)",
            # video.meeting_chat_files (before messages — FK dependency)
            """CREATE TABLE IF NOT EXISTS video.meeting_chat_files (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES public.users(id),
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  size INTEGER NOT NULL,
  content BYTEA NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)""",
            # migrate existing installs: swap storage_path → content
            "ALTER TABLE video.meeting_chat_files ADD COLUMN IF NOT EXISTS content BYTEA NOT NULL DEFAULT ''",
            "ALTER TABLE video.meeting_chat_files DROP COLUMN IF EXISTS storage_path",
            "CREATE INDEX IF NOT EXISTS ix_mcf_booking ON video.meeting_chat_files(booking_id)",
            # video.meeting_chat_messages
            """CREATE TABLE IF NOT EXISTS video.meeting_chat_messages (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES public.users(id),
  body TEXT NOT NULL DEFAULT '',
  file_id INTEGER REFERENCES video.meeting_chat_files(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)""",
            "CREATE INDEX IF NOT EXISTS ix_mcm_booking ON video.meeting_chat_messages(booking_id)",
            "CREATE INDEX IF NOT EXISTS ix_mcm_created ON video.meeting_chat_messages(created_at)",
            # video.meeting_invitations — external guest invite links
            """CREATE TABLE IF NOT EXISTS video.meeting_invitations (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,
  guest_name VARCHAR(128),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  livekit_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  requested_at TIMESTAMPTZ
)""",
            "CREATE INDEX IF NOT EXISTS ix_mi_booking ON video.meeting_invitations(booking_id)",
            "CREATE INDEX IF NOT EXISTS ix_mi_token ON video.meeting_invitations(token)",
            # room invite codes
            "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20) UNIQUE",
            "CREATE INDEX IF NOT EXISTS ix_rooms_invite_code ON rooms(invite_code) WHERE invite_code IS NOT NULL",
            "UPDATE rooms SET invite_code = upper(substring(md5(random()::text || id::text) from 1 for 8)) WHERE invite_code IS NULL",
            # booking types
            "DO $$ BEGIN CREATE TYPE bookingtype AS ENUM ('physical','virtual','hybrid'); EXCEPTION WHEN duplicate_object THEN null; END $$",
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type VARCHAR(10) NOT NULL DEFAULT 'physical'",
            # room join modes
            "DO $$ BEGIN CREATE TYPE roomjoinmode AS ENUM ('open','approval','closed'); EXCEPTION WHEN duplicate_object THEN null; END $$",
            "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS join_mode VARCHAR(10) NOT NULL DEFAULT 'approval'",
            # room join requests
            """CREATE TABLE IF NOT EXISTS room_join_requests (
                id SERIAL PRIMARY KEY,
                room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_rjr_room_ws UNIQUE (room_id, workspace_id)
            )""",
        ]
        for sql in migrations:
            try:
                await conn.execute(text(sql))
            except Exception as e:
                msg = str(e).lower()
                if not any(s in msg for s in ("already exists", "duplicate", "does not exist")):
                    logger.warning(f"Migration skipped: {sql[:80]!r} → {e}")

    # ── 2. Start background session cleanup ───────────────────────────────────
    cleanup_task = asyncio.create_task(_cleanup_expired_sessions())
    attachment_task = asyncio.create_task(_cleanup_attachment_data())
    chat_cleanup_task = asyncio.create_task(_cleanup_chat_data())

    if not settings.BOT_SECRET:
        logger.warning("BOT_SECRET is not set — internal bot API will return 503 on all requests")
    logger.info("Backend ready. TG Bot runs separately (tg/tg/bot.py)")

    yield  # ← FastAPI обрабатывает HTTP-запросы

    cleanup_task.cancel()
    attachment_task.cancel()
    chat_cleanup_task.cancel()
    logger.info("Backend shutting down.")


app = FastAPI(
    title="CorpMeet API",
    version="2.0.0",
    lifespan=lifespan,
)

# ── Rate limiting ─────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────────────────────
_origins = [
    settings.FRONTEND_URL,
    "https://tg.corpmeet.uz",
    "https://corpmeet.uz",
    "https://tg-dev.corpmeet.uz",
]
if settings.CORPMEET_DEV:
    _origins += [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost",
        "http://localhost:80",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Bot-Secret"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(bookings.router, prefix="/api/v1")
app.include_router(slots.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(internal.router, prefix="/api/v1")  # только для TG Bot
app.include_router(submissions.router, prefix="/api/v1")
app.include_router(workspaces.router, prefix="/api/v1")
app.include_router(rooms.router, prefix="/api/v1")
app.include_router(meetings.router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ── Serve production frontend build ─────────────────────────────────────────
import os
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

if _DIST.is_dir():
    # Serve static assets (js, css, images)
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

    # Serve other static files from dist root (logo, vite.svg, etc.)
    for f in _DIST.iterdir():
        if f.is_file() and f.name != "index.html":
            app.mount(f"/{f.name}", StaticFiles(directory=str(_DIST)), name=f"static-{f.name}")

    # SPA fallback: all non-API routes → index.html
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Don't intercept API and docs routes
        if full_path.startswith(("api/", "docs", "openapi.json", "health")):
            return
        dist_resolved = _DIST.resolve()
        file = (_DIST / full_path).resolve()
        if file.is_file() and str(file).startswith(str(dist_resolved)):
            return FileResponse(str(file))
        return FileResponse(str(_DIST / "index.html"))
