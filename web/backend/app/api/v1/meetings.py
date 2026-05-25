import asyncio
import json
import logging
import mimetypes
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import pyseto
from pydantic import BaseModel as _BaseModel
from fastapi import (
    APIRouter, Depends, File, HTTPException, Query,
    UploadFile, WebSocket, WebSocketDisconnect, status,
)
from fastapi.responses import FileResponse, Response
from pyseto import Key
from pyseto.exceptions import DecryptError, PysetoError, VerifyError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.dependencies import get_current_user
from app.models.booking import Booking
from app.models.meeting import MeetingChatFile, MeetingChatMessage, MeetingInvitation, MeetingParticipantLog, MeetingSession
from app.models.user import Role, User
from app.schemas.meeting import (
    AdmitGuestBody, ChatFileResponse, ChatMessageCreate, ChatMessageResponse,
    GuestJoinInfo, GuestRequestBody, InviteLinkResponse, InviteStatusResponse,
    MeetingJoinResponse, RecordingResponse,
)
from app.services.video import create_access_token, derive_e2ee_key, ensure_room_exists, is_participant_in_room, kick_participant, mute_participant, start_recording, stop_recording

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/meetings", tags=["meetings"])

try:
    _PUBLIC_KEY = Key.new(
        version=4, purpose="public",
        key=settings.PASETO_PUBLIC_KEY_PEM.encode("utf-8"),
    )
except Exception:
    _PUBLIC_KEY = None


# ── WebSocket connection manager ──────────────────────────────────────────────

class _ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[int, set[WebSocket]] = {}

    async def connect(self, booking_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self._rooms.setdefault(booking_id, set()).add(ws)

    def disconnect(self, booking_id: int, ws: WebSocket) -> None:
        room = self._rooms.get(booking_id)
        if room is not None:
            room.discard(ws)
            if not room:
                del self._rooms[booking_id]

    async def broadcast(self, booking_id: int, data: dict) -> None:
        dead: set[WebSocket] = set()
        for ws in list(self._rooms.get(booking_id, set())):
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._rooms.get(booking_id, set()).discard(ws)


manager = _ConnectionManager()

# booking_id → set of user_ids who received a join token (pre-authorizes chat access)
_join_authorized: dict[int, set[int]] = {}

# guest_session_token → {booking_id, guest_name, expires_at} — for guest WS chat auth
_guest_sessions: dict[str, dict] = {}

# invite_token → guest_session_token — so status endpoint can return it to the guest
_invite_to_session: dict[str, str] = {}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _ws_auth(token: str, db: AsyncSession) -> User:
    """Verify PASETO token from WS query param, return User."""
    if not _PUBLIC_KEY:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Auth not configured")
    try:
        decoded = pyseto.decode(_PUBLIC_KEY, token)
        payload = json.loads(decoded.payload)
        user_id = int(payload["sub"])
        exp = datetime.fromisoformat(payload["exp"].replace("Z", "+00:00"))
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except HTTPException:
        raise
    except (VerifyError, DecryptError, PysetoError, ValueError, KeyError, json.JSONDecodeError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


async def _get_active_booking(booking_id: int, db: AsyncSession) -> Booking:
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id, Booking.deleted_at.is_(None))
    )
    b = result.scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Booking not found")
    return b


async def _check_meeting_access(booking: Booking, user: User, db: AsyncSession) -> None:
    """Allow organizer, guest by name/username, or actual meeting participant."""
    if booking.user_id == user.id:
        return
    # Pre-authorized via /join endpoint (avoids race with LiveKit webhook)
    if user.id in _join_authorized.get(booking.id, set()):
        return
    # Check guest list
    guests = [str(g).lower() for g in (booking.guests or [])]
    uname = (user.username or "").lower()
    if uname and (uname in guests or f"@{uname}" in guests):
        return
    full_name = f"{user.first_name or ''} {user.last_name or ''}".strip().lower()
    if full_name and full_name in guests:
        return
    # Check meeting_participant_logs
    from app.models.meeting import MeetingParticipantLog
    sub = select(MeetingSession.id).where(MeetingSession.booking_id == booking.id)
    part = await db.execute(
        select(MeetingParticipantLog).where(
            MeetingParticipantLog.session_id.in_(sub),
            MeetingParticipantLog.user_id == user.id,
        )
    )
    if part.scalar_one_or_none():
        return
    raise HTTPException(403, "No access to this meeting")


def _message_to_dict(
    msg: MeetingChatMessage,
    user_name: str,
    file: Optional[MeetingChatFile],
) -> dict:
    file_data = None
    if file:
        file_data = {
            "id": file.id,
            "filename": file.filename,
            "mime_type": file.mime_type,
            "size": file.size,
            "created_at": file.created_at.isoformat(),
        }
    return {
        "id": msg.id,
        "user_id": msg.user_id,
        "user_name": user_name,
        "body": msg.body,
        "file": file_data,
        "created_at": msg.created_at.isoformat(),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/{booking_id}/join", response_model=MeetingJoinResponse)
async def join_meeting(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingJoinResponse:
    booking = await _get_active_booking(booking_id, db)
    if not booking.video_enabled or not booking.video_room_name:
        raise HTTPException(400, "Video not enabled for this booking")

    now = datetime.now(timezone.utc)
    start = booking.start_time if booking.start_time.tzinfo else booking.start_time.replace(tzinfo=timezone.utc)
    end = booking.end_time if booking.end_time.tzinfo else booking.end_time.replace(tzinfo=timezone.utc)

    if now > end + timedelta(hours=2):
        raise HTTPException(403, "Meeting ended more than 2 hours ago")

    # Guests may not enter before the organizer (admins/superadmins bypass this check)
    is_privileged = current_user.role in (Role.admin, Role.superadmin)
    if booking.user_id != current_user.id and not is_privileged:
        organizer_identity = f"user-{booking.user_id}"
        organizer_present = False

        # 1. In-memory pre-auth (organizer called /join this server process)
        if booking.user_id in _join_authorized.get(booking_id, set()):
            organizer_present = True

        # 2. LiveKit room — real-time check (survives backend restarts)
        if not organizer_present and booking.video_room_name:
            organizer_present = await is_participant_in_room(
                booking.video_room_name, organizer_identity
            )

        # 3. Webhook log — may lag 1–5 s after organizer connects
        if not organizer_present:
            sub = select(MeetingSession.id).where(MeetingSession.booking_id == booking_id)
            org_res = await db.execute(
                select(MeetingParticipantLog).where(
                    MeetingParticipantLog.session_id.in_(sub),
                    MeetingParticipantLog.participant_identity == organizer_identity,
                    MeetingParticipantLog.left_at.is_(None),
                )
            )
            if org_res.scalar_one_or_none():
                organizer_present = True

        if not organizer_present:
            raise HTTPException(403, "organizer_not_present")

    # Pre-create room if meeting has already started (no-op if room exists)
    if now >= start:
        try:
            await ensure_room_exists(booking.video_room_name)
        except Exception as exc:
            logger.warning(f"ensure_room_exists failed: {exc}")

    # Kick ghost left by a hard-refresh: LiveKit holds departed WS for ~15 s.
    current_identity = f"user-{current_user.id}"
    if await is_participant_in_room(booking.video_room_name, current_identity):
        await kick_participant(booking.video_room_name, current_identity)
        await asyncio.sleep(0.5)

    token = create_access_token(
        room_name=booking.video_room_name,
        user_id=current_user.id,
        user_name=current_user.display_name or f"user-{current_user.id}",
    )
    # Pre-authorize user for chat access (before LiveKit webhook fires)
    _join_authorized.setdefault(booking_id, set()).add(current_user.id)
    # Evict oldest entry to prevent unbounded growth (one entry per meeting, cap at 500)
    if len(_join_authorized) > 500:
        _join_authorized.pop(next(iter(_join_authorized)))

    return MeetingJoinResponse(
        room_name=booking.video_room_name,
        livekit_url=settings.LIVEKIT_PUBLIC_URL,
        access_token=token,
        user_identity=f"user-{current_user.id}",
        start_time=start,
        end_time=end,
        is_organizer=(booking.user_id == current_user.id or is_privileged),
        e2ee_key=derive_e2ee_key(booking.video_room_name),
    )


@router.get("/{booking_id}/chat", response_model=list[ChatMessageResponse])
async def get_chat_history(
    booking_id: int,
    limit: int = Query(default=500, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatMessageResponse]:
    booking = await _get_active_booking(booking_id, db)
    await _check_meeting_access(booking, current_user, db)

    result = await db.execute(
        select(MeetingChatMessage, User.first_name, User.last_name, User.username)
        .join(User, MeetingChatMessage.user_id == User.id)
        .where(MeetingChatMessage.booking_id == booking_id)
        .order_by(MeetingChatMessage.created_at)
        .limit(limit)
    )
    rows = result.all()

    messages: list[ChatMessageResponse] = []
    for msg, first, last, uname in rows:
        display = f"{first or ''} {last or ''}".strip() or uname or f"user-{msg.user_id}"
        file: Optional[MeetingChatFile] = None
        if msg.file_id:
            file_res = await db.execute(
                select(MeetingChatFile).where(MeetingChatFile.id == msg.file_id)
            )
            file = file_res.scalar_one_or_none()

        messages.append(ChatMessageResponse(
            id=msg.id,
            user_id=msg.user_id,
            user_name=display,
            body=msg.body,
            file=ChatFileResponse.model_validate(file) if file else None,
            created_at=msg.created_at,
        ))
    return messages


@router.post("/{booking_id}/chat", response_model=ChatMessageResponse, status_code=201)
async def post_chat_message(
    booking_id: int,
    payload: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatMessageResponse:
    booking = await _get_active_booking(booking_id, db)
    await _check_meeting_access(booking, current_user, db)

    file: Optional[MeetingChatFile] = None
    if payload.file_id:
        file_res = await db.execute(
            select(MeetingChatFile).where(
                MeetingChatFile.id == payload.file_id,
                MeetingChatFile.booking_id == booking_id,
            )
        )
        file = file_res.scalar_one_or_none()
        if not file:
            raise HTTPException(404, "File not found")

    msg = MeetingChatMessage(
        booking_id=booking_id,
        user_id=current_user.id,
        body=payload.body,
        file_id=payload.file_id,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    display = current_user.display_name or f"user-{current_user.id}"
    data = _message_to_dict(msg, display, file)
    await manager.broadcast(booking_id, data)

    return ChatMessageResponse(
        id=msg.id,
        user_id=msg.user_id,
        user_name=display,
        body=msg.body,
        file=ChatFileResponse.model_validate(file) if file else None,
        created_at=msg.created_at,
    )


@router.post("/{booking_id}/chat/files", response_model=ChatFileResponse, status_code=201)
async def upload_chat_file(
    booking_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatFileResponse:
    booking = await _get_active_booking(booking_id, db)
    await _check_meeting_access(booking, current_user, db)

    content = await file.read()
    if len(content) > settings.CHAT_FILES_MAX_SIZE:
        raise HTTPException(413, f"File too large (max {settings.CHAT_FILES_MAX_SIZE // 1024 // 1024} MB)")
    if not content:
        raise HTTPException(400, "Empty file")

    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    chat_file = MeetingChatFile(
        booking_id=booking_id,
        user_id=current_user.id,
        filename=file.filename or "file",
        mime_type=mime,
        size=len(content),
        content=content,
    )
    db.add(chat_file)
    await db.commit()
    await db.refresh(chat_file)
    return ChatFileResponse.model_validate(chat_file)


@router.get("/{booking_id}/chat/files/{file_id}")
async def download_chat_file(
    booking_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    booking = await _get_active_booking(booking_id, db)
    await _check_meeting_access(booking, current_user, db)

    result = await db.execute(
        select(MeetingChatFile).where(
            MeetingChatFile.id == file_id,
            MeetingChatFile.booking_id == booking_id,
        )
    )
    chat_file = result.scalar_one_or_none()
    if not chat_file:
        raise HTTPException(404, "File not found")
    if not chat_file.content:
        raise HTTPException(410, "File no longer available")

    return Response(
        content=chat_file.content,
        media_type=chat_file.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{chat_file.filename}"'},
    )


@router.get("/{booking_id}/recordings", response_model=list[RecordingResponse])
async def get_recordings(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RecordingResponse]:
    booking = await _get_active_booking(booking_id, db)
    await _check_meeting_access(booking, current_user, db)

    result = await db.execute(
        select(MeetingSession).where(
            MeetingSession.booking_id == booking_id,
            MeetingSession.recording_path.isnot(None),
        ).order_by(MeetingSession.started_at)
    )
    sessions = result.scalars().all()
    return [
        RecordingResponse(
            session_id=s.id,
            room_name=s.room_name,
            has_recording=bool(s.recording_path),
            recording_duration_seconds=s.recording_duration_seconds,
            started_at=s.started_at,
            ended_at=s.ended_at,
        )
        for s in sessions
    ]


@router.get("/{booking_id}/recordings/{session_id}/download")
async def download_recording(
    booking_id: int,
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    booking = await _get_active_booking(booking_id, db)
    await _check_meeting_access(booking, current_user, db)

    result = await db.execute(
        select(MeetingSession).where(
            MeetingSession.id == session_id,
            MeetingSession.booking_id == booking_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session or not session.recording_path:
        raise HTTPException(404, "Recording not found")

    rec_path = Path(session.recording_path)
    if not rec_path.is_file():
        raise HTTPException(410, "Recording file no longer available")

    return FileResponse(
        str(rec_path),
        filename=rec_path.name,
        media_type="video/mp4",
        content_disposition_type="attachment",
    )


@router.post("/{booking_id}/recording/start")
async def start_meeting_recording(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    booking = await _get_active_booking(booking_id, db)
    await _check_meeting_access(booking, current_user, db)
    if booking.user_id != current_user.id and current_user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "Only the organizer can control recording")

    result = await db.execute(
        select(MeetingSession)
        .where(MeetingSession.booking_id == booking_id, MeetingSession.ended_at.is_(None))
        .order_by(MeetingSession.started_at.desc())
    )
    session = result.scalar_one_or_none()
    if not session:
        # Webhook may not have fired yet — create session on demand
        if not booking.video_room_name:
            raise HTTPException(400, "No video room configured for this booking")
        session = MeetingSession(booking_id=booking_id, room_name=booking.video_room_name)
        db.add(session)
        await db.commit()
        await db.refresh(session)
    if session.egress_id:
        raise HTTPException(409, "Recording already in progress")

    try:
        egress_id = await start_recording(session.room_name)
    except Exception as exc:
        raise HTTPException(502, f"Failed to start recording: {exc}")

    session.egress_id = egress_id
    await db.commit()
    return {"egress_id": egress_id}


@router.post("/{booking_id}/recording/stop")
async def stop_meeting_recording(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    booking = await _get_active_booking(booking_id, db)
    await _check_meeting_access(booking, current_user, db)
    if booking.user_id != current_user.id and current_user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "Only the organizer can control recording")

    result = await db.execute(
        select(MeetingSession)
        .where(MeetingSession.booking_id == booking_id, MeetingSession.ended_at.is_(None))
        .order_by(MeetingSession.started_at.desc())
    )
    session = result.scalar_one_or_none()
    if not session or not session.egress_id:
        raise HTTPException(404, "No active recording")

    egress_id = session.egress_id
    try:
        await stop_recording(egress_id)
    except Exception as exc:
        logger.warning(f"stop_recording failed for egress {egress_id}: {exc}")
        raise HTTPException(502, "Failed to stop recording")

    session.egress_id = None
    await db.commit()
    return {"ok": True}


# ── Guest invitation ──────────────────────────────────────────────────────────

@router.post("/{booking_id}/invite", response_model=InviteLinkResponse)
async def create_invite_link(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InviteLinkResponse:
    """Organizer generates a one-use invite link for an external (unregistered) guest."""
    booking = await _get_active_booking(booking_id, db)
    is_privileged = current_user.role in (Role.admin, Role.superadmin)
    if booking.user_id != current_user.id and not is_privileged:
        raise HTTPException(403, "Only the organizer can create invite links")
    if not booking.video_enabled or not booking.video_room_name:
        raise HTTPException(400, "Video not enabled for this booking")

    token = secrets.token_urlsafe(32)
    invite = MeetingInvitation(
        booking_id=booking_id,
        token=token,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(invite)
    await db.commit()

    frontend_url = settings.FRONTEND_URL.rstrip("/")
    invite_url = f"{frontend_url}/meeting/guest/{token}"
    return InviteLinkResponse(invite_url=invite_url, token=token)


@router.get("/invite/{invite_token}", response_model=GuestJoinInfo)
async def get_guest_info(
    invite_token: str,
    db: AsyncSession = Depends(get_db),
) -> GuestJoinInfo:
    """Return meeting info for the guest join page (no auth required)."""
    result = await db.execute(
        select(MeetingInvitation).where(MeetingInvitation.token == invite_token)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invalid invite link")

    now = datetime.now(timezone.utc)
    expires = invite.expires_at if invite.expires_at.tzinfo else invite.expires_at.replace(tzinfo=timezone.utc)
    if now > expires:
        raise HTTPException(410, "Invite link has expired")

    booking = await db.get(Booking, invite.booking_id)
    if not booking or booking.deleted_at:
        raise HTTPException(404, "Booking not found")

    return GuestJoinInfo(
        title=booking.title,
        start_time=booking.start_time,
        end_time=booking.end_time,
        status=invite.status,
        booking_id=booking.id,
    )


@router.post("/invite/{invite_token}/request")
async def request_admission(
    invite_token: str,
    body: GuestRequestBody,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Guest submits their name and requests to be admitted. Notifies organizer via WS."""
    result = await db.execute(
        select(MeetingInvitation).where(MeetingInvitation.token == invite_token)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invalid invite link")

    now = datetime.now(timezone.utc)
    expires = invite.expires_at if invite.expires_at.tzinfo else invite.expires_at.replace(tzinfo=timezone.utc)
    if now > expires:
        raise HTTPException(410, "Invite link has expired")

    # Reusable link: each new guest resets state (previously admitted guest keeps LiveKit connection)
    invite.guest_name = body.guest_name
    invite.status = "requesting"
    invite.requested_at = now
    invite.livekit_token = None
    await db.commit()

    # Notify all meeting participants (organizer will see the admission popup)
    ws_count = len(manager._rooms.get(invite.booking_id, set()))
    logger.info(f"[admission] booking={invite.booking_id}, guest={body.guest_name!r}, active_ws={ws_count}")
    await manager.broadcast(invite.booking_id, {
        "type": "admission_request",
        "invite_token": invite_token,
        "guest_name": body.guest_name,
    })
    return {"ok": True}


@router.get("/invite/{invite_token}/status", response_model=InviteStatusResponse)
async def get_invite_status(
    invite_token: str,
    db: AsyncSession = Depends(get_db),
) -> InviteStatusResponse:
    """Guest polls this endpoint to check if organizer approved/rejected."""
    result = await db.execute(
        select(MeetingInvitation).where(MeetingInvitation.token == invite_token)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invalid invite link")

    if invite.status == "approved" and invite.livekit_token:
        booking = await db.get(Booking, invite.booking_id)
        gst = _invite_to_session.get(invite_token)
        return InviteStatusResponse(
            status="approved",
            livekit_token=invite.livekit_token,
            livekit_url=settings.LIVEKIT_PUBLIC_URL,
            room_name=booking.video_room_name if booking else None,
            booking_id=invite.booking_id,
            guest_session_token=gst,
        )
    return InviteStatusResponse(status=invite.status)


@router.post("/{booking_id}/admit")
async def admit_guest(
    booking_id: int,
    body: AdmitGuestBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Organizer approves or rejects a guest admission request."""
    booking = await _get_active_booking(booking_id, db)
    is_privileged = current_user.role in (Role.admin, Role.superadmin)
    if booking.user_id != current_user.id and not is_privileged:
        raise HTTPException(403, "Only the organizer can admit guests")
    if not booking.video_room_name:
        raise HTTPException(400, "No active video room")

    result = await db.execute(
        select(MeetingInvitation).where(
            MeetingInvitation.token == body.invite_token,
            MeetingInvitation.booking_id == booking_id,
        )
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite.status != "requesting":
        raise HTTPException(409, f"Invite is in '{invite.status}' state, expected 'requesting'")

    guest_session_token: str | None = None
    if body.action == "approve":
        lk_token = create_access_token(
            room_name=booking.video_room_name,
            user_id=0,
            user_name=invite.guest_name or "Гость",
            identity=f"guest-{invite.token[:8]}",
        )
        invite.status = "approved"
        invite.livekit_token = lk_token
        # Create guest chat session for WS auth
        guest_session_token = secrets.token_urlsafe(32)
        _guest_sessions[guest_session_token] = {
            "booking_id": booking_id,
            "guest_name": invite.guest_name or "Гость",
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=24),
        }
        # Evict oldest entries to prevent unbounded growth
        if len(_guest_sessions) > 1000:
            oldest = next(iter(_guest_sessions))
            del _guest_sessions[oldest]
        # Map invite token → session token so the guest can retrieve it via /status
        _invite_to_session[body.invite_token] = guest_session_token
    elif body.action == "reject":
        invite.status = "rejected"
    else:
        raise HTTPException(400, "action must be 'approve' or 'reject'")

    await db.commit()

    await manager.broadcast(booking_id, {
        "type": "admission_response",
        "invite_token": body.invite_token,
        "action": body.action,
        "guest_name": invite.guest_name,
    })
    resp: dict = {"ok": True, "action": body.action, "booking_id": booking_id}
    if guest_session_token:
        resp["guest_session_token"] = guest_session_token
    return resp


@router.get("/{booking_id}/pending-admissions")
async def get_pending_admissions(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Organizer polls for pending admission requests (fallback when WS broadcast is missed)."""
    booking = await _get_active_booking(booking_id, db)
    is_privileged = current_user.role in (Role.admin, Role.superadmin)
    if booking.user_id != current_user.id and not is_privileged:
        raise HTTPException(403, "Only organizer can view pending admissions")
    result = await db.execute(
        select(MeetingInvitation).where(
            MeetingInvitation.booking_id == booking_id,
            MeetingInvitation.status == "requesting",
        )
    )
    invitations = result.scalars().all()
    return [
        {"invite_token": inv.token, "guest_name": inv.guest_name or "Гость"}
        for inv in invitations
    ]


class _MuteBody(_BaseModel):
    muted: bool = True


@router.post("/{booking_id}/participants/{identity}/mute", status_code=204)
async def mute_participant_endpoint(
    booking_id: int,
    identity: str,
    body: _MuteBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Organizer can server-side mute or unmute any participant's microphone."""
    booking = await _get_active_booking(booking_id, db)
    is_privileged = current_user.role in (Role.admin, Role.superadmin)
    if booking.user_id != current_user.id and not is_privileged:
        raise HTTPException(403, "Only organizer can mute participants")
    if not booking.video_room_name:
        raise HTTPException(400, "No active video room")
    try:
        await mute_participant(booking.video_room_name, identity, body.muted)
    except Exception as exc:
        logger.warning("mute_participant failed: %s", exc)
        raise HTTPException(500, "LiveKit mute failed")


@router.websocket("/{booking_id}/chat/ws")
async def chat_websocket(
    websocket: WebSocket,
    booking_id: int,
    token: str = Query(default=""),
    guest_token: str = Query(default=""),
) -> None:
    # Accept FIRST so browser sees WS as OPEN; then auth
    await websocket.accept()

    user_id: int
    user_display: str
    is_guest = False

    effective_token = token or websocket.cookies.get("access_token", "")

    if effective_token:
        # Regular user auth via PASETO
        async with AsyncSessionLocal() as init_db:
            try:
                user = await _ws_auth(effective_token, init_db)
            except HTTPException:
                await websocket.send_json({"error": "unauthorized"})
                await websocket.close(code=4401)
                return

            booking_res = await init_db.execute(
                select(Booking).where(Booking.id == booking_id, Booking.deleted_at.is_(None))
            )
            booking_obj = booking_res.scalar_one_or_none()
            if not booking_obj:
                await websocket.send_json({"error": "not_found"})
                await websocket.close(code=4404)
                return

            try:
                await _check_meeting_access(booking_obj, user, init_db)
            except HTTPException:
                await websocket.send_json({"error": "forbidden"})
                await websocket.close(code=4403)
                return

        user_id = user.id
        user_display = user.display_name or f"user-{user.id}"

    elif guest_token:
        # Guest auth via session token from /admit
        session = _guest_sessions.get(guest_token)
        if not session:
            await websocket.send_json({"error": "unauthorized"})
            await websocket.close(code=4401)
            return
        expires = session["expires_at"]
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            del _guest_sessions[guest_token]
            await websocket.send_json({"error": "session_expired"})
            await websocket.close(code=4401)
            return
        booking_id = session["booking_id"]
        user_id = 0
        user_display = session["guest_name"]
        is_guest = True

    else:
        await websocket.send_json({"error": "unauthorized"})
        await websocket.close(code=4401)
        return

    manager._rooms.setdefault(booking_id, set()).add(websocket)
    logger.info(f"[chat_ws] {'guest' if is_guest else 'user'}={user_display!r} joined booking={booking_id}, total_ws={len(manager._rooms.get(booking_id, set()))}")
    try:
        while True:
            data = await websocket.receive_json()

            if not isinstance(data, dict):
                continue

            # Reaction — broadcast only, no DB
            if data.get("type") == "reaction":
                emoji = str(data.get("emoji", ""))[:10]
                await manager.broadcast(booking_id, {
                    "type": "reaction", "emoji": emoji,
                    "user_id": user_id, "user_name": user_display,
                })
                continue

            # Hand raise — broadcast only, no DB
            if data.get("type") == "hand_raise":
                await manager.broadcast(booking_id, {
                    "type": "hand_raise",
                    "user_id": user_id,
                    "user_name": user_display,
                    "raised": bool(data.get("raised", False)),
                })
                continue

            # Record permission — organizer only, broadcast to grantee
            if data.get("type") == "record_permission":
                if not is_guest and user_id != 0:
                    async with AsyncSessionLocal() as perm_db:
                        b = await perm_db.get(Booking, booking_id)
                        if b and b.user_id == user_id:
                            await manager.broadcast(booking_id, {
                                "type": "record_permission",
                                "grantee_identity": str(data.get("grantee_identity", "")),
                            })
                continue

            try:
                payload = ChatMessageCreate.model_validate(data)
            except Exception:
                await websocket.send_json({"error": "Invalid message"})
                continue

            if is_guest:
                # Guests have no DB user — broadcast only (ephemeral message)
                import time
                broadcast_data = {
                    "id": int(time.time() * 1000),
                    "user_id": 0,
                    "user_name": user_display,
                    "body": payload.body,
                    "file": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                await manager.broadcast(booking_id, broadcast_data)
                continue

            # Fresh session per message — prevents stale connection after long idle
            async with AsyncSessionLocal() as db:
                file: Optional[MeetingChatFile] = None
                if payload.file_id:
                    file_res = await db.execute(
                        select(MeetingChatFile).where(
                            MeetingChatFile.id == payload.file_id,
                            MeetingChatFile.booking_id == booking_id,
                        )
                    )
                    file = file_res.scalar_one_or_none()

                msg = MeetingChatMessage(
                    booking_id=booking_id,
                    user_id=user_id,
                    body=payload.body,
                    file_id=payload.file_id,
                )
                db.add(msg)
                await db.commit()
                await db.refresh(msg)

            await manager.broadcast(booking_id, _message_to_dict(msg, user_display, file))
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(booking_id, websocket)
        logger.info(f"[chat_ws] user={user_id} left booking={booking_id}, remaining_ws={len(manager._rooms.get(booking_id, set()))}")
