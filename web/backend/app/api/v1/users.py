import secrets
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.limiter import limiter
from app.models.booking import Booking
from app.models.user import Role, User
from app.schemas.user import UserPublicResponse, UserResponse

router = APIRouter(prefix="/users", tags=["users"])

ADMIN_ROLES = {Role.admin, Role.superadmin}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return current_user


_ALLOWED_AVATARS = {
    "/avatars/free-icon-angry-17849457.png",
    "/avatars/free-icon-confused-mind-17849496.png",
    "/avatars/free-icon-evil-17849470.png",
    "/avatars/free-icon-freeze-17849460.png",
    "/avatars/free-icon-joyful-17849480.png",
    "/avatars/free-icon-meme-17849485.png",
    "/avatars/free-icon-meme-17849488.png",
    "/avatars/free-icon-mind-blowing-17849471.png",
    "/avatars/free-icon-proud-17849494.png",
    "/avatars/free-icon-thoughtful-emoji-17849509.png",
}


class AvatarBody(BaseModel):
    avatar: str | None = None


@router.patch("/me/avatar")
async def set_avatar(
    body: AvatarBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if body.avatar is not None and body.avatar not in _ALLOWED_AVATARS:
        raise HTTPException(400, "Invalid avatar")
    current_user.avatar = body.avatar
    await db.commit()
    await db.refresh(current_user)
    return {"avatar": current_user.avatar}


@router.get("/search", response_model=list[UserPublicResponse])
@limiter.limit("30/minute")
async def search_users(
    request: Request,
    q: str = Query(default="", description="Search by name or @username"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserPublicResponse]:
    order = func.coalesce(User.first_name, User.name, User.username)
    if not q.strip():
        result = await db.execute(
            select(User)
            .where(User.id != current_user.id, User.is_active == True)  # noqa: E712
            .order_by(order)
            .limit(50)
        )
    else:
        escaped = q.strip().lstrip("@").replace("%", "\\%").replace("_", "\\_")
        term = f"%{escaped}%"
        result = await db.execute(
            select(User).where(
                User.is_active == True,  # noqa: E712
                or_(
                    User.name.ilike(term),
                    User.first_name.ilike(term),
                    User.last_name.ilike(term),
                    User.username.ilike(term),
                ),
            ).order_by(order).limit(20)
        )
    return result.scalars().all()


class ReminderBody(BaseModel):
    default_reminder_minutes: int


@router.patch("/me/reminder")
async def set_reminder(
    body: ReminderBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if body.default_reminder_minutes < 1 or body.default_reminder_minutes > 1440:
        raise HTTPException(400, "default_reminder_minutes must be between 1 and 1440")
    current_user.default_reminder_minutes = body.default_reminder_minutes
    await db.commit()
    await db.refresh(current_user)
    return {"default_reminder_minutes": current_user.default_reminder_minutes}


@router.post("/feed-token", response_model=dict)
async def get_feed_token(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not current_user.feed_token:
        current_user.feed_token = secrets.token_urlsafe(32)
        await db.commit()
        await db.refresh(current_user)
    return {"feed_token": current_user.feed_token}


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/admin/users", response_model=list[UserResponse])
async def admin_list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserResponse]:
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Admin only")
    result = await db.execute(
        select(User)
        .where(User.is_active == True)  # noqa: E712 — exclude soft-deleted users
        .order_by(User.created_at.desc())
    )
    return result.scalars().all()


class SetRoleBody(BaseModel):
    role: str


@router.patch("/admin/users/{user_id}/role")
async def admin_set_role(
    user_id: int,
    body: SetRoleBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if current_user.role != Role.superadmin:
        raise HTTPException(403, "Superadmin only")
    new_role = body.role
    if new_role not in ("user", "admin"):
        raise HTTPException(400, "role must be 'user' or 'admin'")
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "User not found")
    if target.id == current_user.id:
        raise HTTPException(400, "Cannot change your own role")
    if target.role == Role.superadmin:
        raise HTTPException(403, "Cannot change superadmin role")
    target.role = Role(new_role)
    await db.commit()
    return {"id": target.id, "role": new_role}


class AdminCreateUser(BaseModel):
    name: str
    username: str | None = None
    role: str = "user"


@router.post("/admin/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_user(
    body: AdminCreateUser,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    if current_user.role != Role.superadmin:
        raise HTTPException(403, "Superadmin only")
    if body.role not in ("user", "admin"):
        raise HTTPException(400, "role must be 'user' or 'admin'")
    user = User(
        telegram_id=None,
        name=body.name,
        first_name=body.name.split()[0] if body.name else None,
        last_name=body.name.split()[1] if body.name and len(body.name.split()) > 1 else None,
        username=body.username,
        role=Role(body.role),
        is_active=True,
        is_registered=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


class AdminInviteBody(BaseModel):
    username: str


@router.post("/admin/invite")
async def admin_invite_user(
    body: AdminInviteBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if current_user.role != Role.superadmin:
        raise HTTPException(403, "Superadmin only")
    username = body.username.lstrip("@").strip()
    if not username:
        raise HTTPException(400, "Username required")

    bot_link = f"https://t.me/{settings.TG_BOT_USERNAME}"

    result = await db.execute(
        select(User).where(User.username == username, User.is_active == True)  # noqa: E712
    )
    existing = result.scalar_one_or_none()

    if existing and existing.telegram_id:
        name = existing.first_name or existing.name or username
        msg = (
            f"👋 Привет, <b>{name}</b>!\n\n"
            "Вас приглашают присоединиться к <b>CorpMeet</b> — корпоративной системе бронирования переговорных.\n\n"
            "📅 Бронируйте переговорные, управляйте встречами и отслеживайте расписание прямо в браузере.\n\n"
            f"🚀 Открыть приложение:\n{settings.FRONTEND_URL}"
        )
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(
                    f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
                    json={"chat_id": existing.telegram_id, "text": msg, "parse_mode": "HTML"},
                )
            if resp.status_code == 200:
                return {"created": False, "sent": True, "link": bot_link}
        except Exception:
            pass

    return {"created": False, "sent": False, "link": bot_link}


@router.delete("/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    if current_user.role != Role.superadmin:
        raise HTTPException(403, "Superadmin only")
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "User not found")
    if target.id == current_user.id:
        raise HTTPException(400, "Cannot delete yourself")
    if target.role == Role.superadmin:
        raise HTTPException(403, "Cannot delete superadmin")
    # Soft-delete: deactivate the user and cancel future bookings.
    # Hard-deleting via db.delete() would trigger FK CASCADE on bookings.user_id,
    # destroying soft-delete metadata and breaking cancellation notifications.
    now_utc = datetime.now(timezone.utc)
    bookings_result = await db.execute(
        select(Booking).where(Booking.user_id == user_id, Booking.deleted_at.is_(None))
    )
    for b in bookings_result.scalars().all():
        b.deleted_at = now_utc
    target.is_active = False
    await db.commit()


@router.get("/admin/stats")
async def admin_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Admin only")
    total_users = (await db.execute(
        select(func.count(User.id)).where(User.is_active == True)  # noqa: E712
    )).scalar_one()
    total_bookings = (await db.execute(
        select(func.count(Booking.id)).where(Booking.deleted_at.is_(None))
    )).scalar_one()
    now = datetime.now(timezone.utc)
    active_bookings = (await db.execute(
        select(func.count(Booking.id)).where(
            Booking.start_time <= now, Booking.end_time >= now,
            Booking.deleted_at.is_(None),
        )
    )).scalar_one()
    return {
        "total_users": total_users,
        "total_bookings": total_bookings,
        "active_bookings": active_bookings,
    }
