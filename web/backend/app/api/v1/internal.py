"""
Внутренний роутер /api/v1/internal/*

Доступен только для TG Bot-а. Защищён заголовком X-Bot-Secret.
Пользователи и внешние клиенты к этим эндпоинтам доступа не имеют.
Исключение: /livekit/webhook — верифицируется подписью LiveKit, не X-Bot-Secret.
"""
import hmac
import logging
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models.attachment import BookingAttachment
from app.models.booking import Booking
from app.models.browser_session import BrowserSession
from app.models.meeting import MeetingParticipantLog, MeetingSession
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceMemberRole, WorkspaceMemberStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


# ── Аутентификация бота ───────────────────────────────────────────────────────

def verify_bot_secret(x_bot_secret: str = Header(..., alias="X-Bot-Secret")) -> None:
    """Проверяет секрет бота. 503 если не настроен, 401 если не совпадает."""
    if not settings.BOT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="BOT_SECRET is not configured",
        )
    if not hmac.compare_digest(x_bot_secret.encode(), settings.BOT_SECRET.encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing bot secret",
        )


# ── Схемы ответов ─────────────────────────────────────────────────────────────

class UserBotInfo(BaseModel):
    id: int
    telegram_id: int | None
    username: str | None
    display_name: str

    class Config:
        from_attributes = True


class GuestInfo(BaseModel):
    name: str
    telegram_id: int | None = None
    display_name: str | None = None


class BookingBotInfo(BaseModel):
    id: int
    title: str
    description: str | None
    start_time: datetime
    end_time: datetime
    prev_start_time: datetime | None = None
    prev_end_time: datetime | None = None
    guests: list[GuestInfo]
    reminder_sent: bool
    created_at: datetime
    updated_at: datetime
    user: UserBotInfo
    recurrence: str = "none"
    recurrence_until: date | None = None
    recurrence_group_id: int | None = None
    recurrence_days: list[int] | None = None
    has_attachments: bool = False
    video_enabled: bool = False
    booking_type: str = "physical"
    workspace_id: int | None = None
    workspace_telegram_chat_id: int | None = None
    room_id: int | None = None
    room_name: str | None = None

    class Config:
        from_attributes = True


POSITIONS = [
    "Начальник департамента/отдела",
    "PM",
    "Аналитик",
    "Программист и др.",
    "Дизайнер",
]


class InviteNotificationInfo(BaseModel):
    member_id: int
    workspace_id: int
    workspace_name: str
    telegram_id: int


class EnsureUserRequest(BaseModel):
    telegram_id: int
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None
    full_name: str | None = None


class SetPositionRequest(BaseModel):
    telegram_id: int
    position: str


class ConsumeSessionRequest(BaseModel):
    token: str
    telegram_id: int
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None
    language_code: str | None = None


# ── Хелперы ──────────────────────────────────────────────────────────────────

async def _resolve_guests(db: AsyncSession, names: list[str]) -> dict[str, tuple[int | None, str | None]]:
    """Batch-resolve guest name strings → (telegram_id, display_name).

    Matches against User.name, User.username, and first_name+last_name
    (all case-insensitive). Returns {original_name: (telegram_id, display_name)}.
    """
    if not names:
        return {}
    lower = [n.lstrip("@").lower() for n in names]
    result = await db.execute(
        select(User).where(
            or_(
                func.lower(User.name).in_(lower),
                func.lower(User.username).in_(lower),
                func.lower(func.concat(
                    func.coalesce(User.first_name, ""), " ",
                    func.coalesce(User.last_name, ""),
                )).in_(lower),
            )
        )
    )
    users = result.scalars().all()
    lookup: dict[str, tuple[int | None, str | None]] = {}
    for u in users:
        candidates = [
            u.name,
            u.username,
            f"{u.first_name or ''} {u.last_name or ''}".strip() or None,
        ]
        for val in filter(None, candidates):
            lookup[val.lower()] = (u.telegram_id, u.display_name)
    return {n: lookup.get(n.lstrip("@").lower(), (None, None)) for n in names}


def _make_guests(raw: list[str], lookup: dict[str, tuple[int | None, str | None]]) -> list[GuestInfo]:
    return [
        GuestInfo(name=n, telegram_id=lookup.get(n, (None, None))[0], display_name=lookup.get(n, (None, None))[1] or n)
        for n in raw
    ]


async def _bookings_with_attachments(db: AsyncSession, booking_ids: list[int]) -> set[int]:
    """One query — returns the subset of booking_ids that have at least one Attachment."""
    if not booking_ids:
        return set()
    result = await db.execute(
        select(BookingAttachment.booking_id)
        .where(BookingAttachment.booking_id.in_(booking_ids))
        .distinct()
    )
    return set(result.scalars().all())


async def _workspace_tg_chat_ids(db: AsyncSession, workspace_ids: list[int]) -> dict[int, int | None]:
    """Batch fetch telegram_chat_id for each workspace_id."""
    if not workspace_ids:
        return {}
    result = await db.execute(
        select(Workspace.id, Workspace.telegram_chat_id)
        .where(Workspace.id.in_(workspace_ids))
    )
    return {row[0]: row[1] for row in result.all()}


# ── Эндпоинты: встречи ────────────────────────────────────────────────────────

@router.get(
    "/bookings/since",
    response_model=list[BookingBotInfo],
    summary="Встречи, обновлённые после указанного времени (для уведомлений)",
)
async def bookings_since(
    updated_at: datetime,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> list[BookingBotInfo]:
    """
    Возвращает встречи требующие уведомления (updated_at позже notified_at).
    Бот использует для отправки уведомлений в группу и гостям.
    Идемпотентно: после возврата помечает notified_at = updated_at, чтобы
    повторный вызов не вернул ту же встречу до следующего изменения.
    """
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.user), selectinload(Booking.room))
        .where(and_(
            Booking.updated_at >= updated_at,
            Booking.deleted_at.is_(None),
            or_(
                Booking.notified_at.is_(None),
                Booking.updated_at > Booking.notified_at,
            ),
        ))
        .order_by(Booking.updated_at)
    )
    bookings = result.scalars().all()

    # Resolve guests before commit (expire_on_commit would break attribute access after)
    all_names = list({n for b in bookings for n in b.guests})
    lookup = await _resolve_guests(db, all_names)
    with_atts = await _bookings_with_attachments(db, [b.id for b in bookings])
    ws_ids = list({b.workspace_id for b in bookings if b.workspace_id})
    ws_tg_map = await _workspace_tg_chat_ids(db, ws_ids)

    infos = [
        BookingBotInfo(
            id=b.id,
            title=b.title,
            description=b.description,
            start_time=b.start_time,
            end_time=b.end_time,
            guests=_make_guests(b.guests, lookup),
            reminder_sent=b.reminder_sent,
            created_at=b.created_at,
            updated_at=b.updated_at,
            user=UserBotInfo(
                id=b.user.id,
                telegram_id=b.user.telegram_id,
                username=b.user.username,
                display_name=b.user.display_name,
            ),
            recurrence=b.recurrence,
            recurrence_until=b.recurrence_until,
            recurrence_group_id=b.recurrence_group_id,
            recurrence_days=b.recurrence_days or None,
            has_attachments=b.id in with_atts,
            video_enabled=b.video_enabled,
            booking_type=b.booking_type if b.booking_type else "physical",
            workspace_id=b.workspace_id,
            workspace_telegram_chat_id=ws_tg_map.get(b.workspace_id) if b.workspace_id else None,
            room_id=b.room_id,
            room_name=b.room.name if b.room else None,
        )
        for b in bookings
    ]
    for b in bookings:
        b.notified_at = b.updated_at
    if bookings:
        await db.commit()
    return infos


@router.get(
    "/bookings/reminders",
    response_model=list[BookingBotInfo],
    summary="Встречи, которым нужно отправить напоминание (с учётом кастомного времени)",
)
async def bookings_for_reminder(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> list[BookingBotInfo]:
    """
    Возвращает встречи, для которых наступило время напоминания и reminder_sent = false.
    Время напоминания = start_time - reminder_minutes (per-booking или user default, иначе 15 мин).
    Бот вызывает каждые 60 сек.
    """
    now = datetime.now(timezone.utc)
    # Load all future unreminded bookings within max possible reminder window (24 h)
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.user), selectinload(Booking.room))
        .where(and_(
            Booking.start_time > now,
            Booking.start_time <= now + timedelta(hours=25),
            Booking.reminder_sent == False,  # noqa: E712
            Booking.deleted_at.is_(None),
        ))
    )
    bookings = result.scalars().all()

    due: list[Booking] = []
    for b in bookings:
        effective_mins = (
            b.reminder_minutes
            if b.reminder_minutes is not None
            else (b.user.default_reminder_minutes if b.user.default_reminder_minutes is not None else 15)
        )
        trigger_time = b.start_time - timedelta(minutes=effective_mins)
        # Fire within a window: up to 30 s past trigger (handles late polls) and 2 min ahead
        if now - timedelta(seconds=30) <= trigger_time <= now + timedelta(minutes=2):
            due.append(b)

    all_names = list({n for b in due for n in b.guests})
    lookup = await _resolve_guests(db, all_names)
    with_atts = await _bookings_with_attachments(db, [b.id for b in due])
    ws_ids = list({b.workspace_id for b in due if b.workspace_id})
    ws_tg_map = await _workspace_tg_chat_ids(db, ws_ids)

    return [
        BookingBotInfo(
            id=b.id,
            title=b.title,
            description=b.description,
            start_time=b.start_time,
            end_time=b.end_time,
            guests=_make_guests(b.guests, lookup),
            reminder_sent=b.reminder_sent,
            created_at=b.created_at,
            updated_at=b.updated_at,
            user=UserBotInfo(
                id=b.user.id,
                telegram_id=b.user.telegram_id,
                username=b.user.username,
                display_name=b.user.display_name,
            ),
            recurrence=b.recurrence,
            recurrence_until=b.recurrence_until,
            recurrence_group_id=b.recurrence_group_id,
            recurrence_days=b.recurrence_days or None,
            has_attachments=b.id in with_atts,
            video_enabled=b.video_enabled,
            booking_type=b.booking_type if b.booking_type else "physical",
            workspace_id=b.workspace_id,
            workspace_telegram_chat_id=ws_tg_map.get(b.workspace_id) if b.workspace_id else None,
            room_id=b.room_id,
            room_name=b.room.name if b.room else None,
        )
        for b in due
    ]


@router.post(
    "/bookings/{booking_id}/mark-reminded",
    summary="Поставить reminder_sent = true для встречи",
)
async def mark_reminded(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """Вызывается ботом после успешной отправки напоминания."""
    result = await db.execute(select(Booking).where(Booking.id == booking_id))
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    booking.reminder_sent = True
    await db.commit()
    return {"ok": True, "id": booking_id}


@router.get(
    "/bookings/deleted-since",
    response_model=list[BookingBotInfo],
    summary="Встречи, удалённые после указанного времени (для уведомлений об отмене)",
)
async def bookings_deleted_since(
    since: datetime,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> list[BookingBotInfo]:
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.user), selectinload(Booking.room))
        .where(and_(
            Booking.deleted_at.isnot(None),
            Booking.deleted_at >= since,
            Booking.cancel_notified_at.is_(None),
        ))
        .order_by(Booking.deleted_at)
    )
    bookings = result.scalars().all()

    # Build response BEFORE commit — same expire_on_commit issue as /bookings/since
    all_names = list({n for b in bookings for n in b.guests})
    lookup = await _resolve_guests(db, all_names)
    with_atts = await _bookings_with_attachments(db, [b.id for b in bookings])
    ws_ids = list({b.workspace_id for b in bookings if b.workspace_id})
    ws_tg_map = await _workspace_tg_chat_ids(db, ws_ids)

    infos = [
        BookingBotInfo(
            id=b.id, title=b.title, description=b.description,
            start_time=b.start_time, end_time=b.end_time,
            guests=_make_guests(b.guests, lookup),
            reminder_sent=b.reminder_sent,
            created_at=b.created_at, updated_at=b.updated_at,
            user=UserBotInfo(
                id=b.user.id, telegram_id=b.user.telegram_id,
                username=b.user.username, display_name=b.user.display_name,
            ),
            recurrence=b.recurrence,
            recurrence_until=b.recurrence_until,
            recurrence_group_id=b.recurrence_group_id,
            recurrence_days=b.recurrence_days or None,
            has_attachments=b.id in with_atts,
            video_enabled=b.video_enabled,
            booking_type=b.booking_type if b.booking_type else "physical",
            workspace_id=b.workspace_id,
            workspace_telegram_chat_id=ws_tg_map.get(b.workspace_id) if b.workspace_id else None,
            room_id=b.room_id,
            room_name=b.room.name if b.room else None,
        )
        for b in bookings
    ]
    now_utc = datetime.now(timezone.utc)
    for b in bookings:
        b.cancel_notified_at = now_utc
    if bookings:
        await db.commit()
    return infos


# ── Эндпоинты: инвайты в пространства (deep-link flow) ───────────────────────

@router.get(
    "/workspace-invites/pending",
    response_model=list[InviteNotificationInfo],
    summary="Инвайты, требующие отправки уведомления в Telegram",
)
async def pending_invite_notifications(
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> list[InviteNotificationInfo]:
    """
    Возвращает членов пространства, добавленных через инвайт, которым ещё не было
    отправлено уведомление (invite_notified_at IS NULL). Бот поллит этот эндпоинт
    и отправляет сообщение в Telegram.
    """
    result = await db.execute(
        select(WorkspaceMember, Workspace, User)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.invite_notified_at.is_(None),
            WorkspaceMember.invited_by_user_id.isnot(None),
            User.telegram_id.isnot(None),
        )
        .order_by(WorkspaceMember.created_at)
    )
    rows = result.all()
    return [
        InviteNotificationInfo(
            member_id=member.id,
            workspace_id=ws.id,
            workspace_name=ws.name,
            telegram_id=user.telegram_id,
        )
        for member, ws, user in rows
    ]


@router.post(
    "/workspace-invites/{mid}/mark-notified",
    summary="Пометить инвайт как уведомлённый",
)
async def mark_invite_notified(
    mid: int,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """Вызывается ботом после успешной отправки уведомления об инвайте."""
    result = await db.execute(select(WorkspaceMember).where(WorkspaceMember.id == mid))
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member.invite_notified_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True, "id": mid}


@router.get(
    "/invites/by-token/{token}",
    summary="Получить данные инвайта по токену (при /start invite_TOKEN)",
)
async def get_invite_by_token(
    token: str,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """
    Бот вызывает при /start invite_<TOKEN>.
    Возвращает данные пространства и пригласившего, чтобы показать пользователю
    кнопки «Принять / Отказаться».
    """
    result = await db.execute(
        select(WorkspaceMember, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.invite_token == token)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Invite not found or already used")
    member, ws = row

    inviter_name: str | None = None
    if member.invited_by_user_id:
        inv_res = await db.execute(select(User).where(User.id == member.invited_by_user_id))
        inviter = inv_res.scalar_one_or_none()
        if inviter:
            inviter_name = inviter.display_name

    return {
        "member_id": member.id,
        "workspace_id": ws.id,
        "workspace_name": ws.name,
        "status": member.status,
        "inviter_name": inviter_name,
        "user": {
            "telegram_id": member.user.telegram_id if member.user else None,
            "has_position": bool(member.user and member.user.position),
            "display_name": member.user.display_name if member.user else None,
        } if member.user_id else None,
    }


@router.post(
    "/invites/{mid}/accept",
    summary="Принять инвайт (пользователь нажал «Принять» в боте)",
)
async def accept_invite(
    mid: int,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """Переводит member.status → active и сбрасывает invite_token."""
    result = await db.execute(select(WorkspaceMember).where(WorkspaceMember.id == mid))
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.status != WorkspaceMemberStatus.pending:
        raise HTTPException(status_code=400, detail="Invite is not in pending state")
    if member.user_id is None and not member.pending_username:
        raise HTTPException(status_code=400, detail="Anonymous invite must be claimed via /invites/claim")
    member.status = WorkspaceMemberStatus.active
    member.invite_token = None
    await db.commit()
    return {"ok": True, "id": mid}


class ClaimInviteRequest(BaseModel):
    token: str
    telegram_id: int
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None


@router.post(
    "/invites/claim",
    summary="Принять анонимный инвайт (пользователь перешёл по ссылке без username)",
)
async def claim_invite(
    body: ClaimInviteRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """
    Вызывается ботом при /start invite_{token} когда invite создан без username.
    Создаёт пользователя если нужно, привязывает к инвайту, автоматически принимает.
    """
    member = await db.scalar(
        select(WorkspaceMember).where(WorkspaceMember.invite_token == body.token)
    )
    if not member:
        raise HTTPException(status_code=404, detail="Invite not found or already used")
    if member.status != WorkspaceMemberStatus.pending:
        raise HTTPException(status_code=400, detail="Invite is not in pending state")

    # Создать или обновить пользователя
    user = await db.scalar(select(User).where(User.telegram_id == body.telegram_id))
    if not user:
        name = f"{body.first_name or ''} {body.last_name or ''}".strip() or body.username or str(body.telegram_id)
        user = User(
            telegram_id=body.telegram_id,
            first_name=body.first_name,
            last_name=body.last_name,
            name=name,
            username=body.username,
            is_registered=True,
            is_active=True,
        )
        db.add(user)
        await db.flush()
    elif body.username and body.username != user.username:
        user.username = body.username

    # Проверить что этот пользователь не уже в пространстве
    existing = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == member.workspace_id,
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.id != member.id,
        )
    )
    if existing:
        # Уже состоит — просто гасим токен
        await db.delete(member)
        ws = await db.scalar(select(Workspace).where(Workspace.id == existing.workspace_id))
        await db.commit()
        return {"ok": True, "already_member": True, "status": existing.status.value, "workspace_name": ws.name if ws else ""}

    member.user_id = user.id
    member.pending_username = None
    member.status = WorkspaceMemberStatus.active
    member.invite_token = None

    ws = await db.scalar(select(Workspace).where(Workspace.id == member.workspace_id))
    await db.commit()
    return {"ok": True, "already_member": False, "status": "active", "workspace_name": ws.name if ws else ""}


@router.post(
    "/invites/{mid}/reject",
    summary="Отклонить инвайт (пользователь нажал «Отказаться» в боте)",
)
async def reject_invite(
    mid: int,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """Удаляет запись member (отказ от инвайта)."""
    result = await db.execute(select(WorkspaceMember).where(WorkspaceMember.id == mid))
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.status != WorkspaceMemberStatus.pending:
        raise HTTPException(status_code=400, detail="Invite is not in pending state")
    await db.delete(member)
    await db.commit()
    return {"ok": True, "id": mid}


# ── Эндпоинты: пользователи ───────────────────────────────────────────────────

@router.post(
    "/users/ensure",
    summary="Создать пользователя по данным Telegram, если ещё не существует",
)
async def ensure_user(
    body: EnsureUserRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """
    Вызывается при /start без токена.
    Создаёт запись User из telegram_id если её нет. Обновляет username если изменился.
    """
    result = await db.execute(
        select(User).where(User.telegram_id == body.telegram_id)
    )
    user = result.scalar_one_or_none()

    created = False
    if not user:
        created = True
        user = User(
            telegram_id=body.telegram_id,
            first_name=body.first_name,
            last_name=body.last_name,
            name=body.full_name or f"{body.first_name or ''} {body.last_name or ''}".strip(),
            username=body.username,
            is_registered=False,
            is_active=True,
        )
        db.add(user)
        await db.flush()

    # Обновляем username если изменился
    elif body.username and body.username != user.username:
        user.username = body.username

    # Связываем pending_username записи с пользователем (если его пригласили до регистрации)
    pending_invites: list[dict] = []
    if body.username:
        clean_username = body.username.lstrip("@")
        pm_res = await db.execute(
            select(WorkspaceMember, Workspace)
            .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
            .where(
                WorkspaceMember.pending_username == clean_username,
                WorkspaceMember.user_id.is_(None),
            )
        )
        for member, ws in pm_res.all():
            member.user_id = user.id
            member.pending_username = None
            pending_invites.append({"workspace_id": ws.id, "workspace_name": ws.name, "member_id": member.id})

    await db.commit()
    return {
        "ok": True,
        "created": created,
        "has_position": user.position is not None,
        "pending_invites": pending_invites,
    }


@router.get(
    "/users/by-username/{username}",
    summary="Найти пользователя по @username (для отправки личного уведомления)",
)
async def get_user_by_username(
    username: str,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """Возвращает telegram_id пользователя по username, или 404."""
    clean = username.lstrip("@")
    result = await db.execute(select(User).where(User.username == clean))
    user = result.scalar_one_or_none()
    if not user or not user.telegram_id:
        raise HTTPException(status_code=404, detail="User not found or has no telegram_id")
    return {"telegram_id": user.telegram_id, "display_name": user.display_name}


@router.post("/users/position", summary="Установить должность пользователя из Telegram")
async def set_user_position(
    body: SetPositionRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    if body.position not in POSITIONS:
        raise HTTPException(status_code=400, detail=f"Invalid position. Allowed: {POSITIONS}")
    result = await db.execute(select(User).where(User.telegram_id == body.telegram_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.position = body.position
    await db.commit()
    return {"ok": True}


# ── Эндпоинты: авторизация ────────────────────────────────────────────────────

@router.post(
    "/auth/consume-session",
    summary="Сжечь browser_session токен (QR/deep-link авторизация)",
)
async def consume_session_bot(
    body: ConsumeSessionRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """
    Вызывается при /start {token}.
    Три режима по префиксу токена:
      invite_{token} — принять личное приглашение в пространство
      ws_{code}      — войти в пространство по публичному коду
      <другое>       — QR/deep-link авторизация в браузере
    """
    # ── invite_{token}: личное приглашение ───────────────────────────────────
    if body.token.startswith("invite_"):
        invite_token = body.token[len("invite_"):]
        member = await db.scalar(
            select(WorkspaceMember).where(WorkspaceMember.invite_token == invite_token)
        )
        if not member:
            raise HTTPException(status_code=404, detail="Invite not found or already used")
        if member.status != WorkspaceMemberStatus.pending:
            raise HTTPException(status_code=400, detail="Invite already used")

        user = await db.scalar(select(User).where(User.telegram_id == body.telegram_id))
        if not user:
            name = (f"{body.first_name or ''} {body.last_name or ''}".strip()
                    or body.username or str(body.telegram_id))
            user = User(
                telegram_id=body.telegram_id,
                first_name=body.first_name,
                last_name=body.last_name,
                name=name,
                username=body.username,
                language_code=body.language_code,
                is_registered=False,
                is_active=True,
            )
            db.add(user)
            await db.flush()

        existing_member = await db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == member.workspace_id,
                WorkspaceMember.user_id == user.id,
                WorkspaceMember.id != member.id,
            )
        )
        if existing_member:
            await db.delete(member)
        else:
            member.user_id = user.id
            member.pending_username = None
            member.status = WorkspaceMemberStatus.active
            member.invite_token = None

        await db.commit()
        return {"ok": True}

    # ── ws_{code}: публичный код пространства ────────────────────────────────
    if body.token.startswith("ws_"):
        ws_code = body.token[len("ws_"):]
        workspace = await db.scalar(
            select(Workspace).where(
                Workspace.invite_code == ws_code,
                Workspace.archived_at.is_(None),
            )
        )
        if not workspace:
            raise HTTPException(status_code=404, detail="Workspace not found")

        user = await db.scalar(select(User).where(User.telegram_id == body.telegram_id))
        if not user:
            name = (f"{body.first_name or ''} {body.last_name or ''}".strip()
                    or body.username or str(body.telegram_id))
            user = User(
                telegram_id=body.telegram_id,
                first_name=body.first_name,
                last_name=body.last_name,
                name=name,
                username=body.username,
                language_code=body.language_code,
                is_registered=False,
                is_active=True,
            )
            db.add(user)
            await db.flush()

        existing_member = await db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.user_id == user.id,
            )
        )
        if not existing_member:
            db.add(WorkspaceMember(
                workspace_id=workspace.id,
                user_id=user.id,
                role=WorkspaceMemberRole.member,
                status=WorkspaceMemberStatus.active,
            ))
            await db.commit()

        return {"ok": True}

    # ── QR / browser deep-link session ───────────────────────────────────────
    result = await db.execute(
        select(BrowserSession).where(BrowserSession.token == body.token).with_for_update()
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.used:
        raise HTTPException(status_code=410, detail="Session already used")

    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Session expired")

    # Находим пользователя по telegram_id
    user_result = await db.execute(select(User).where(User.telegram_id == body.telegram_id))
    user = user_result.scalar_one_or_none()

    if session.user_id:
        # Обычная сессия (из Mini App) — привязать telegram_id если не задан
        if not user:
            existing = await db.execute(select(User).where(User.id == session.user_id))
            user = existing.scalar_one_or_none()
            if user and not user.telegram_id:
                user.telegram_id = body.telegram_id
    else:
        # QR-сессия (user_id=NULL) — создать юзера если не существует.
        # Имена ОБЯЗАТЕЛЬНЫ — бот должен предварительно спросить у юзера
        # имя/фамилию в чате и передать сюда.
        if not user:
            first = (body.first_name or "").strip()
            last  = (body.last_name or "").strip()
            if not first:
                raise HTTPException(
                    status_code=400,
                    detail="first_name required for new user registration",
                )
            display = f"{first} {last}".strip()
            user = User(
                telegram_id=body.telegram_id,
                first_name=first,
                last_name=last or None,
                name=display,
                username=body.username,
                language_code=body.language_code,
                is_registered=True,
                is_active=True,
            )
            db.add(user)
            await db.flush()
        session.user_id = user.id

    # Токен НЕ сжигаем здесь — это делает фронт при опросе
    # /api/v1/auth/session/{token} в обмен на JWT. Иначе фронт получает 410.
    await db.commit()

    return {"ok": True}


# ── Эндпоинты: пространства ──────────────────────────────────────────────────

class BindTelegramRequest(BaseModel):
    invite_code: str
    chat_id: int
    telegram_user_id: int


class BindTelegramResponse(BaseModel):
    workspace_name: str


class UnbindTelegramRequest(BaseModel):
    chat_id: int
    telegram_user_id: int


@router.post("/workspaces/bind-telegram", response_model=BindTelegramResponse)
async def bind_workspace_telegram(
    payload: BindTelegramRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> BindTelegramResponse:
    """Привязать TG-группу к пространству по invite_code. Вызывается ботом через /bind."""
    ws = await db.scalar(select(Workspace).where(Workspace.invite_code == payload.invite_code))
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")

    user = await db.scalar(select(User).where(User.telegram_id == payload.telegram_user_id))
    if not user:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User not registered in CorpMeet")

    member = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ws.id,
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == WorkspaceMemberStatus.active,
            WorkspaceMember.role.in_([WorkspaceMemberRole.owner, WorkspaceMemberRole.admin]),
        )
    )
    if not member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Must be owner or admin to bind")

    ws.telegram_chat_id = payload.chat_id
    await db.commit()
    return BindTelegramResponse(workspace_name=ws.name)


@router.post("/workspaces/unbind-telegram")
async def unbind_workspace_telegram(
    payload: UnbindTelegramRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """Отвязать TG-группу от пространства. Вызывается ботом через /unbind."""
    ws = await db.scalar(select(Workspace).where(Workspace.telegram_chat_id == payload.chat_id))
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No workspace bound to this chat")

    user = await db.scalar(select(User).where(User.telegram_id == payload.telegram_user_id))
    if not user:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User not registered in CorpMeet")

    member = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ws.id,
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == WorkspaceMemberStatus.active,
            WorkspaceMember.role.in_([WorkspaceMemberRole.owner, WorkspaceMemberRole.admin]),
        )
    )
    if not member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Must be owner or admin to unbind")

    ws.telegram_chat_id = None
    await db.commit()
    return {"ok": True, "workspace_name": ws.name}


class WorkspaceJoinByInviteRequest(BaseModel):
    invite_code: str
    telegram_id: int
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None


@router.post(
    "/workspaces/join-by-invite",
    summary="Вступить в пространство по универсальной ссылке-приглашению (ws_CODE)",
)
async def join_workspace_by_invite(
    body: WorkspaceJoinByInviteRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_bot_secret),
) -> dict:
    """
    Вызывается ботом при /start ws_{invite_code}.
    Создаёт пользователя если не существует, добавляет в пространство как active member.
    Идемпотентен: повторный вызов возвращает текущий статус без ошибки.
    """
    ws = await db.scalar(select(Workspace).where(Workspace.invite_code == body.invite_code))
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Создать или обновить пользователя
    user = await db.scalar(select(User).where(User.telegram_id == body.telegram_id))
    if not user:
        name = f"{body.first_name or ''} {body.last_name or ''}".strip() or body.username or str(body.telegram_id)
        user = User(
            telegram_id=body.telegram_id,
            first_name=body.first_name,
            last_name=body.last_name,
            name=name,
            username=body.username,
            is_registered=True,
            is_active=True,
        )
        db.add(user)
        await db.flush()
    elif body.username and body.username != user.username:
        user.username = body.username

    # Проверить существующее членство
    existing = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ws.id,
            WorkspaceMember.user_id == user.id,
        )
    )
    if existing:
        return {"ok": True, "already_member": True, "status": existing.status.value, "workspace_name": ws.name}

    new_member = WorkspaceMember(
        workspace_id=ws.id,
        user_id=user.id,
        role=WorkspaceMemberRole.member,
        status=WorkspaceMemberStatus.active,
    )
    db.add(new_member)
    await db.commit()
    return {"ok": True, "already_member": False, "status": "active", "workspace_name": ws.name}


# ── LiveKit webhook (подпись проверяется самим LiveKit JWT, не X-Bot-Secret) ──

@router.post("/livekit/webhook", include_in_schema=False)
async def livekit_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Принимает события от LiveKit-сервера.
    Аутентификация: JWT-подпись в заголовке Authorization (LiveKit-стандарт).
    """
    from app.services.video import start_recording, stop_recording, verify_webhook

    auth_header = request.headers.get("Authorization", "")
    body = await request.body()
    try:
        event = verify_webhook(body, auth_header)
    except Exception as exc:
        logger.warning(f"Invalid LiveKit webhook signature: {exc}")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid LiveKit signature")

    event_type: str = event.event
    room_name: str = event.room.name if event.room else ""

    if not room_name and event_type not in ("egress_ended", "egress_started", "egress_updated"):
        return {"ok": True}

    # ── room_started: создать сессию и запустить запись ──────────────────────
    if event_type == "room_started":
        # Resolve booking_id from room_name (format: corpmeet-{id}-{random})
        booking_id_parsed: int | None = None
        parts = room_name.split("-")
        if len(parts) >= 2:
            try:
                booking_id_parsed = int(parts[1])
            except ValueError:
                logger.warning(f"Cannot parse booking_id from room_name: {room_name}")

        if booking_id_parsed is not None:
            session = MeetingSession(booking_id=booking_id_parsed, room_name=room_name)
            db.add(session)
            await db.commit()

    # ── room_finished: закрыть сессию ────────────────────────────────────────
    elif event_type == "room_finished":
        result = await db.execute(
            select(MeetingSession)
            .where(MeetingSession.room_name == room_name, MeetingSession.ended_at.is_(None))
            .order_by(MeetingSession.started_at.desc())
        )
        session = result.scalar_one_or_none()
        if session:
            session.ended_at = datetime.now(timezone.utc)
            if session.egress_id:
                try:
                    await stop_recording(session.egress_id)
                except Exception:
                    pass
            await db.commit()

    # ── participant_joined ────────────────────────────────────────────────────
    elif event_type == "participant_joined":
        result = await db.execute(
            select(MeetingSession)
            .where(MeetingSession.room_name == room_name, MeetingSession.ended_at.is_(None))
            .order_by(MeetingSession.started_at.desc())
        )
        session = result.scalar_one_or_none()
        if session:
            identity: str = event.participant.identity if event.participant else ""
            user_id: int | None = None
            if identity.startswith("user-"):
                try:
                    user_id = int(identity[5:])
                except ValueError:
                    pass
            log = MeetingParticipantLog(
                session_id=session.id,
                user_id=user_id,
                participant_identity=identity,
            )
            db.add(log)
            await db.commit()

    # ── participant_left ──────────────────────────────────────────────────────
    elif event_type == "participant_left":
        identity = event.participant.identity if event.participant else ""
        result = await db.execute(
            select(MeetingSession)
            .where(MeetingSession.room_name == room_name, MeetingSession.ended_at.is_(None))
            .order_by(MeetingSession.started_at.desc())
        )
        session = result.scalar_one_or_none()
        if session:
            log_res = await db.execute(
                select(MeetingParticipantLog).where(
                    MeetingParticipantLog.session_id == session.id,
                    MeetingParticipantLog.participant_identity == identity,
                    MeetingParticipantLog.left_at.is_(None),
                )
            )
            log = log_res.scalar_one_or_none()
            if log:
                log.left_at = datetime.now(timezone.utc)
                await db.commit()

    # ── egress_ended: сохранить путь к записи ────────────────────────────────
    elif event_type == "egress_ended":
        egress_info = event.egress_info
        if egress_info:
            egress_id: str = egress_info.egress_id
            recording_path: str | None = None
            if egress_info.file_results:
                raw_path = egress_info.file_results[0].location
                # Egress container writes to /out/; backend reads from /app/data/recordings/
                if raw_path and raw_path.startswith("/out/"):
                    raw_path = raw_path.replace("/out/", "/app/data/recordings/", 1)
                recording_path = raw_path
            # duration is in nanoseconds (int64 in proto)
            duration_sec: int | None = int(egress_info.duration // 1_000_000_000) if egress_info.duration else None

            result = await db.execute(
                select(MeetingSession).where(MeetingSession.egress_id == egress_id)
            )
            session = result.scalar_one_or_none()
            if session:
                if recording_path:
                    session.recording_path = recording_path
                if duration_sec is not None:
                    session.recording_duration_seconds = duration_sec
                await db.commit()

    return {"ok": True}
