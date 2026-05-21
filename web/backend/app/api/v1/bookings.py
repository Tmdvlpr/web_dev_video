import io
import logging
import mimetypes
from datetime import date, datetime, time, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # type: ignore

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import String, and_, cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.attachment import BookingAttachment
from app.models.booking import Booking
from app.models.room import RoomVisibility, WorkspaceRoom
from app.models.user import Role, User
from app.models.workspace import WorkspaceMember, WorkspaceMemberStatus
from pydantic import BaseModel
from app.schemas.booking import BookingCreate, BookingResponse, BookingUpdate
from app.schemas.user import UserPublicResponse
from app.services.video import ensure_room_exists, generate_room_name

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bookings", tags=["bookings"])


def _ical_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\r", "\\n").replace("\n", "\\n")


@router.get("/feed/{feed_token}")
async def public_ical_feed(
    feed_token: str,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    from sqlalchemy import select as _select
    user_result = await db.execute(
        _select(User).where(User.feed_token == feed_token)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(404, "Feed not found")

    result = await db.execute(
        _select(Booking)
        .options(selectinload(Booking.user))
        .where(and_(Booking.user_id == user.id, Booking.deleted_at.is_(None)))
        .order_by(Booking.start_time)
    )
    bookings = result.scalars().all()

    def fmt_dt(dt: datetime) -> str:
        return dt.strftime("%Y%m%dT%H%M%SZ")

    lines: list[str] = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//CorpMeet//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
        f"X-PUBLISHED-TTL:PT15M",
    ]
    for b in bookings:
        guests_note = ("\\nГости: " + ", ".join(f"@{g}" for g in b.guests)) if b.guests else ""
        desc = (_ical_escape(b.description or "") + guests_note).strip()
        video_url = f"{settings.FRONTEND_URL}/meeting/{b.id}" if b.video_enabled else None
        if video_url:
            desc = (desc + ("\\n" if desc else "") + f"Видеоконференция: {video_url}").strip()
        lines += [
            "BEGIN:VEVENT",
            f"UID:corpmeet-{b.id}@corpmeet",
            f"DTSTAMP:{fmt_dt(datetime.now(timezone.utc))}",
            f"DTSTART:{fmt_dt(b.start_time)}",
            f"DTEND:{fmt_dt(b.end_time)}",
            f"SUMMARY:{_ical_escape(b.title)}",
            f"ORGANIZER;CN={_ical_escape(b.user.display_name)}:mailto:noreply@corpmeet",
            *(["DESCRIPTION:" + desc] if desc else []),
            *(["URL:" + video_url] if video_url else []),
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    content = "\r\n".join(lines)
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": "inline; filename=corpmeet.ics"},
    )


ADMIN_ROLES = {Role.admin, Role.superadmin}


@router.get("/admin/all", response_model=list[BookingResponse])
async def admin_list_bookings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookingResponse]:
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Admin only")
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.user))
        .where(Booking.deleted_at.is_(None))
        .order_by(Booking.start_time.desc())
        .limit(200)
    )
    return result.scalars().all()


def _local(dt: datetime) -> datetime:
    try:
        tz = ZoneInfo(settings.APP_TIMEZONE)
    except Exception:
        tz = timezone.utc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz)


@router.get("/export")
async def export_bookings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.user))
        .where(and_(Booking.user_id == current_user.id, Booking.deleted_at.is_(None)))
        .order_by(Booking.start_time)
    )
    bookings = result.scalars().all()

    def fmt_dt(dt: datetime) -> str:
        return dt.strftime("%Y%m%dT%H%M%SZ")

    lines: list[str] = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//CorpMeet//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    ]
    for b in bookings:
        guests_note = ("\\nГости: " + ", ".join(f"@{g}" for g in b.guests)) if b.guests else ""
        desc = (_ical_escape(b.description or "") + guests_note).strip()
        video_url = f"{settings.FRONTEND_URL}/meeting/{b.id}" if b.video_enabled else None
        if video_url:
            desc = (desc + ("\\n" if desc else "") + f"Видеоконференция: {video_url}").strip()
        lines += [
            "BEGIN:VEVENT",
            f"UID:corpmeet-{b.id}@corpmeet",
            f"DTSTAMP:{fmt_dt(datetime.now(timezone.utc))}",
            f"DTSTART:{fmt_dt(b.start_time)}",
            f"DTEND:{fmt_dt(b.end_time)}",
            f"SUMMARY:{_ical_escape(b.title)}",
            f"ORGANIZER;CN={_ical_escape(b.user.display_name)}:mailto:noreply@corpmeet",
            *(["DESCRIPTION:" + desc] if desc else []),
            *(["URL:" + video_url] if video_url else []),
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    content = "\r\n".join(lines)
    filename = f"corpmeet_{datetime.now().strftime('%Y%m%d')}.ics"
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/active", response_model=list[BookingResponse])
async def list_active(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookingResponse]:
    """Current user's bookings (organizer or guest) for the next 30 days."""
    now = datetime.now(timezone.utc)

    guest_conds: list = [Booking.user_id == current_user.id]
    if current_user.username:
        uname = current_user.username.lower()
        for val in [uname, f"@{uname}"]:
            guest_conds.append(
                cast(Booking.guests, String).like(f'%"{val}"%')
            )
    name = f"{current_user.first_name or ''} {current_user.last_name or ''}".strip()
    if name:
        guest_conds.append(
            cast(Booking.guests, String).like(f'%"{name}"%')
        )

    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.user))
        .where(and_(
            Booking.end_time >= now,
            Booking.start_time <= now + timedelta(days=30),
            or_(*guest_conds),
            Booking.deleted_at.is_(None),
        ))
        .order_by(Booking.start_time)
    )
    return result.scalars().all()


def _redacted_booking(b: Booking) -> BookingResponse:
    """Return a booking with all sensitive fields stripped (for busy_only visibility)."""
    return BookingResponse(
        id=b.id,
        title="Занято",
        description=None,
        start_time=b.start_time,
        end_time=b.end_time,
        user_id=0,
        user=UserPublicResponse(id=0, first_name=None, last_name=None, username=None, role="user"),
        created_at=b.created_at,
        guests=[],
        recurrence="none",
        recurrence_until=None,
        recurrence_group_id=None,
        recurrence_days=[],
        reminder_minutes=None,
        workspace_id=None,
        room_id=b.room_id,
        video_enabled=False,
        video_room_name=None,
    )


async def _check_workspace_member(workspace_id: int, user: User, db: AsyncSession) -> None:
    """Raise 403 if user is not an active member of the workspace. Superadmins bypass."""
    if user.role == Role.superadmin:
        return
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == WorkspaceMemberStatus.active,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(403, "Not a member of this workspace")


@router.get("/room-status", response_model=list[BookingResponse])
async def room_status(
    workspace_id: int | None = Query(default=None, description="Filter by accessible rooms in this workspace"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookingResponse]:
    """Bookings overlapping [now-1h, now+24h] for room-status badges.
    Bookings from other workspaces on busy_only rooms are redacted to 'Занято'."""
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=1)
    window_end = now + timedelta(hours=24)

    conds = [
        Booking.end_time >= window_start,
        Booking.start_time <= window_end,
        Booking.deleted_at.is_(None),
    ]

    busy_only_room_ids: set[int] = set()

    if workspace_id is not None:
        await _check_workspace_member(workspace_id, current_user, db)

        ws_rooms_res = await db.execute(
            select(WorkspaceRoom).where(WorkspaceRoom.workspace_id == workspace_id)
        )
        ws_rooms = ws_rooms_res.scalars().all()
        accessible_room_ids = [wr.room_id for wr in ws_rooms]
        busy_only_room_ids = {wr.room_id for wr in ws_rooms if wr.visibility == RoomVisibility.busy_only}

        if not accessible_room_ids:
            return []
        conds.append(Booking.room_id.in_(accessible_room_ids))

    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.user))
        .where(and_(*conds))
        .order_by(Booking.start_time)
    )
    bookings = result.scalars().all()

    if not busy_only_room_ids:
        return bookings  # type: ignore[return-value]

    return [
        _redacted_booking(b)
        if (b.room_id in busy_only_room_ids and b.workspace_id != workspace_id)
        else b
        for b in bookings
    ]  # type: ignore[return-value]


@router.get("", response_model=list[BookingResponse])
async def list_bookings(
    date_from: date = Query(alias="date_from", description="Start date (YYYY-MM-DD)"),
    date_to: date | None = Query(default=None, alias="date_to", description="End date (YYYY-MM-DD), defaults to date_from"),
    workspace_id: int | None = Query(default=None, description="Filter bookings by workspace"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookingResponse]:
    end_date = date_to or date_from
    day_start = datetime.combine(date_from, time.min).replace(tzinfo=timezone.utc)
    day_end = datetime.combine(end_date, time.max).replace(tzinfo=timezone.utc)

    busy_only_room_ids: set[int] = set()

    if workspace_id is not None:
        await _check_workspace_member(workspace_id, current_user, db)

        # Load all rooms accessible to this workspace
        ws_rooms_res = await db.execute(
            select(WorkspaceRoom).where(WorkspaceRoom.workspace_id == workspace_id)
        )
        ws_rooms = ws_rooms_res.scalars().all()
        accessible_room_ids = [wr.room_id for wr in ws_rooms]
        busy_only_room_ids = {wr.room_id for wr in ws_rooms if wr.visibility == RoomVisibility.busy_only}

        if accessible_room_ids:
            # All bookings for accessible rooms + own workspace bookings without a room
            conds = [
                Booking.start_time >= day_start,
                Booking.start_time <= day_end,
                Booking.deleted_at.is_(None),
                or_(
                    Booking.room_id.in_(accessible_room_ids),
                    Booking.workspace_id == workspace_id,
                ),
            ]
        else:
            conds = [
                Booking.start_time >= day_start,
                Booking.start_time <= day_end,
                Booking.deleted_at.is_(None),
                Booking.workspace_id == workspace_id,
            ]
    else:
        # No workspace context — show only the caller's own bookings
        guest_conds: list = [Booking.user_id == current_user.id]
        if current_user.username:
            uname = current_user.username.lower()
            for val in [uname, f"@{uname}"]:
                guest_conds.append(cast(Booking.guests, String).like(f'%"{val}"%'))
        name = f"{current_user.first_name or ''} {current_user.last_name or ''}".strip()
        if name:
            guest_conds.append(cast(Booking.guests, String).like(f'%"{name}"%'))
        conds = [
            Booking.start_time >= day_start,
            Booking.start_time <= day_end,
            Booking.deleted_at.is_(None),
            or_(*guest_conds),
        ]

    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.user))
        .where(and_(*conds))
        .order_by(Booking.start_time)
    )
    bookings = result.scalars().all()

    if not busy_only_room_ids:
        return bookings  # type: ignore[return-value]

    return [
        _redacted_booking(b)
        if (b.room_id in busy_only_room_ids and b.workspace_id != workspace_id)
        else b
        for b in bookings
    ]  # type: ignore[return-value]


@router.post("", response_model=list[BookingResponse], status_code=status.HTTP_201_CREATED)
async def create_booking(
    payload: BookingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookingResponse]:
    if payload.start_time >= payload.end_time:
        raise HTTPException(400, "start_time must be before end_time")
    duration_min = (payload.end_time - payload.start_time).total_seconds() / 60
    if duration_min < 15:
        raise HTTPException(400, "Минимальная длительность — 15 минут")
    if duration_min > 480:
        raise HTTPException(400, "Максимальная длительность — 8 часов")

    now_utc = datetime.now(timezone.utc)
    start_aware = payload.start_time if payload.start_time.tzinfo else payload.start_time.replace(tzinfo=timezone.utc)
    if start_aware < now_utc:
        raise HTTPException(400, "Нельзя бронировать время в прошлом")

    duration = payload.end_time - payload.start_time
    slots: list[tuple[datetime, datetime]] = [(payload.start_time, payload.end_time)]

    effective_until = payload.recurrence_until
    if payload.recurrence != "none" and not effective_until:
        default_days = 30 if payload.recurrence == "daily" else 90
        effective_until = (payload.start_time + timedelta(days=default_days)).date()

    if payload.recurrence != "none" and effective_until:
        until_dt = datetime.combine(effective_until, time.max).replace(tzinfo=timezone.utc)
        MAX_OCC = 90
        if payload.recurrence == "custom" and payload.recurrence_days:
            cur = payload.start_time + timedelta(days=1)
            while cur <= until_dt and len(slots) < MAX_OCC:
                if cur.weekday() in payload.recurrence_days:
                    slots.append((cur, cur + duration))
                cur += timedelta(days=1)
        else:
            delta = timedelta(days=1 if payload.recurrence == "daily" else 7)
            cur = payload.start_time + delta
            while cur <= until_dt and len(slots) < MAX_OCC:
                slots.append((cur, cur + duration))
                cur += delta

    if payload.room_id is not None and payload.recurrence == "none":
        ov = await db.execute(
            select(Booking).where(and_(
                Booking.room_id == payload.room_id,
                Booking.start_time < payload.end_time,
                Booking.end_time > payload.start_time,
                Booking.deleted_at.is_(None),
            )).with_for_update()
        )
        if ov.scalar_one_or_none():
            raise HTTPException(status.HTTP_409_CONFLICT, "Комната занята в это время")

    group_id = (int(now_utc.timestamp() * 1000) * 100000 + current_user.id) if len(slots) > 1 else None
    created: list[Booking] = []

    for s, e in slots:
        if payload.recurrence != "none" and payload.room_id is not None:
            ov = await db.execute(
                select(Booking).where(and_(
                    Booking.room_id == payload.room_id,
                    Booking.start_time < e,
                    Booking.end_time > s,
                    Booking.deleted_at.is_(None),
                )).with_for_update()
            )
            if ov.scalar_one_or_none():
                continue
        b = Booking(
            title=payload.title, description=payload.description,
            start_time=s, end_time=e, user_id=current_user.id,
            guests=payload.guests, recurrence=payload.recurrence,
            recurrence_until=effective_until, recurrence_group_id=group_id,
            recurrence_days=payload.recurrence_days,
            reminder_minutes=payload.reminder_minutes,
            workspace_id=payload.workspace_id,
            room_id=payload.room_id,
            video_enabled=payload.video_enabled,
        )
        db.add(b)
        created.append(b)

    if not created:
        raise HTTPException(status.HTTP_409_CONFLICT, "Все временные слоты заняты")

    await db.commit()
    ids = [b.id for b in created]
    for b in created:
        await db.refresh(b)

    if payload.video_enabled:
        for b in created:
            b.video_room_name = generate_room_name(b.id)
        await db.commit()
        for b in created:
            await db.refresh(b)
            try:
                await ensure_room_exists(b.video_room_name)
            except Exception as exc:
                logger.warning(f"LiveKit room creation failed (non-fatal): {exc}")

    result = await db.execute(
        select(Booking).options(selectinload(Booking.user))
        .where(Booking.id.in_(ids)).order_by(Booking.start_time)
    )
    return list(result.scalars().all())


@router.patch("/{booking_id}", response_model=BookingResponse)
async def update_booking(
    booking_id: int,
    payload: BookingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookingResponse:
    result = await db.execute(
        select(Booking).options(selectinload(Booking.user)).where(Booking.id == booking_id)
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(404, "Booking not found")
    if booking.user_id != current_user.id and current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Not allowed")

    new_start = payload.start_time or booking.start_time
    new_end = payload.end_time or booking.end_time
    if new_start >= new_end:
        raise HTTPException(400, "start_time must be before end_time")

    ov = await db.execute(
        select(Booking).where(and_(
            Booking.id != booking_id,
            Booking.start_time < new_end,
            Booking.end_time > new_start,
            Booking.deleted_at.is_(None),
        )).with_for_update()
    )
    if ov.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Время пересекается с существующим бронированием")

    if payload.title is not None:
        booking.title = payload.title
    if payload.description is not None:
        booking.description = payload.description
    # Save previous time before changing (for notification with old→new)
    if payload.start_time is not None or payload.end_time is not None:
        booking.prev_start_time = booking.start_time
        booking.prev_end_time = booking.end_time
    if payload.start_time is not None:
        booking.start_time = payload.start_time
        booking.reminder_sent = False
    if payload.end_time is not None:
        booking.end_time = payload.end_time
    if payload.guests is not None:
        booking.guests = payload.guests
    if "reminder_minutes" in payload.model_fields_set:
        booking.reminder_minutes = payload.reminder_minutes
    if payload.video_enabled is True and not booking.video_room_name:
        booking.video_enabled = True
        booking.video_room_name = generate_room_name(booking.id)
    elif payload.video_enabled is True:
        booking.video_enabled = True
    elif payload.video_enabled is False:
        booking.video_enabled = False
        booking.video_room_name = None

    await db.commit()
    await db.refresh(booking)

    if payload.video_enabled is True and booking.video_room_name:
        try:
            await ensure_room_exists(booking.video_room_name)
        except Exception as exc:
            logger.warning(f"LiveKit room creation failed (non-fatal): {exc}")

    result2 = await db.execute(
        select(Booking).options(selectinload(Booking.user)).where(Booking.id == booking.id)
    )
    return result2.scalar_one()


@router.delete("/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_booking(
    booking_id: int,
    delete_series: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id, Booking.deleted_at.is_(None))
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(404, "Booking not found")
    if booking.user_id != current_user.id and current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Not allowed")

    now_utc = datetime.now(timezone.utc)
    if delete_series and booking.recurrence_group_id:
        series = await db.execute(
            select(Booking).where(and_(
                Booking.recurrence_group_id == booking.recurrence_group_id,
                Booking.start_time >= now_utc,
                Booking.deleted_at.is_(None),
            ))
        )
        for b in series.scalars().all():
            b.deleted_at = now_utc
    else:
        booking.deleted_at = now_utc

    await db.commit()


# ── Вложения ─────────────────────────────────────────────────────────────────

_MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

_ALLOWED_MIME_PREFIXES = ("image/", "application/pdf")
_ALLOWED_MIME_EXACT = {
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


class AttachmentMeta(BaseModel):
    id: int
    booking_id: int
    filename: str
    mime_type: str
    size: int
    created_at: datetime
    expired: bool

    class Config:
        from_attributes = True


def _is_guest(booking: Booking, user: User) -> bool:
    guests = [str(g).lower() for g in (booking.guests or [])]
    if user.username:
        uname = user.username.lower()
        if uname in guests or f"@{uname}" in guests:
            return True
    name = f"{user.first_name or ''} {user.last_name or ''}".strip().lower()
    return bool(name and name in guests)


def _can_access(booking: Booking, user: User) -> bool:
    return booking.user_id == user.id or user.role == Role.superadmin or _is_guest(booking, user)


async def _get_booking_or_404(booking_id: int, db: AsyncSession) -> Booking:
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id, Booking.deleted_at.is_(None))
    )
    b = result.scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Booking not found")
    return b


@router.post("/{booking_id}/attachments", response_model=AttachmentMeta, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    booking_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AttachmentMeta:
    booking = await _get_booking_or_404(booking_id, db)

    if booking.user_id != current_user.id and current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Только организатор или администратор может загружать файлы")

    if booking.end_time < datetime.now(timezone.utc):
        raise HTTPException(400, "Встреча уже завершена, загрузка невозможна")

    data = await file.read()
    if len(data) > _MAX_FILE_SIZE:
        raise HTTPException(400, "Файл превышает 10 МБ")
    if not data:
        raise HTTPException(400, "Пустой файл")

    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    allowed = any(mime.startswith(p) for p in _ALLOWED_MIME_PREFIXES) or mime in _ALLOWED_MIME_EXACT
    if not allowed:
        raise HTTPException(400, f"Тип файла не поддерживается: {mime}")

    att = BookingAttachment(
        booking_id=booking_id,
        uploader_id=current_user.id,
        filename=file.filename or "file",
        mime_type=mime,
        size=len(data),
        data=data,
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)

    return AttachmentMeta(
        id=att.id, booking_id=att.booking_id, filename=att.filename,
        mime_type=att.mime_type, size=att.size, created_at=att.created_at,
        expired=False,
    )


@router.get("/{booking_id}/attachments", response_model=list[AttachmentMeta])
async def list_attachments(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[AttachmentMeta]:
    booking = await _get_booking_or_404(booking_id, db)

    if not _can_access(booking, current_user):
        raise HTTPException(403, "Нет доступа к вложениям этой встречи")

    now = datetime.now(timezone.utc)
    is_expired = booking.end_time.replace(tzinfo=timezone.utc) < now if booking.end_time.tzinfo is None else booking.end_time < now

    result = await db.execute(
        select(
            BookingAttachment.id,
            BookingAttachment.booking_id,
            BookingAttachment.filename,
            BookingAttachment.mime_type,
            BookingAttachment.size,
            BookingAttachment.created_at,
        ).where(BookingAttachment.booking_id == booking_id)
        .order_by(BookingAttachment.created_at)
    )
    rows = result.all()
    return [
        AttachmentMeta(
            id=r.id, booking_id=r.booking_id, filename=r.filename,
            mime_type=r.mime_type, size=r.size, created_at=r.created_at,
            expired=is_expired,
        )
        for r in rows
    ]


@router.get("/{booking_id}/attachments/{attachment_id}")
async def download_attachment(
    booking_id: int,
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    booking = await _get_booking_or_404(booking_id, db)

    if not _can_access(booking, current_user):
        raise HTTPException(403, "Нет доступа к вложениям этой встречи")

    result = await db.execute(
        select(BookingAttachment).where(
            BookingAttachment.id == attachment_id,
            BookingAttachment.booking_id == booking_id,
        )
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(404, "Вложение не найдено")

    data = bytes(att.data) if att.data is not None else b""
    if not data:
        raise HTTPException(410, "Файл удалён: встреча завершена")

    from urllib.parse import quote as _quote
    ascii_name = att.filename.encode("ascii", "replace").decode("ascii").replace('"', '\\"')
    encoded_name = _quote(att.filename, safe="")
    return Response(
        content=data,
        media_type=att.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded_name}'},
    )


@router.delete("/{booking_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    booking_id: int,
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    booking = await _get_booking_or_404(booking_id, db)

    if booking.user_id != current_user.id and current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Только организатор или администратор может удалять файлы")

    result = await db.execute(
        select(BookingAttachment).where(
            BookingAttachment.id == attachment_id,
            BookingAttachment.booking_id == booking_id,
        )
    )
    att = result.scalar_one_or_none()
    if not att:
        raise HTTPException(404, "Вложение не найдено")

    await db.delete(att)
    await db.commit()
