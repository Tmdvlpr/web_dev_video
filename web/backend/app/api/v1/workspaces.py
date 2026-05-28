import re
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.booking import Booking
from app.models.user import Role, User
from app.models.workspace import (
    Workspace,
    WorkspaceMember,
    WorkspaceMemberRole,
    WorkspaceMemberStatus,
)
from app.schemas.workspace import (
    InviteRequest,
    JoinRequest,
    WorkspaceCreate,
    WorkspaceDetailResponse,
    WorkspaceMemberResponse,
    WorkspaceResponse,
    WorkspaceUpdate,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


# ── Helpers ──────────────────────────────────────────────────────────────────


def _slugify(name: str) -> str:
    """Lowercase, replace non-[a-z0-9-] with dashes, collapse and strip dashes, max 50 chars."""
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:50] or "workspace"


async def _generate_unique_slug(name: str, db: AsyncSession) -> str:
    """Generate a unique slug by appending -2, -3, etc. if it already exists."""
    base = _slugify(name)
    slug = base
    suffix = 2
    while True:
        res = await db.execute(select(Workspace.id).where(Workspace.slug == slug))
        if res.scalar_one_or_none() is None:
            return slug
        slug = f"{base}-{suffix}"
        suffix += 1
        if suffix > 10000:
            return f"{base}-{secrets.token_hex(3)}"


def _generate_invite_code() -> str:
    """Generate a URL-safe invite code (~8 chars)."""
    return secrets.token_urlsafe(6)


async def _get_my_membership(
    workspace_id: int,
    user: User,
    db: AsyncSession,
    *,
    require_active: bool = True,
) -> WorkspaceMember:
    """Get the current user's membership in workspace_id or raise 404/403."""
    ws_res = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id, Workspace.archived_at.is_(None))
    )
    workspace = ws_res.scalar_one_or_none()
    if not workspace:
        raise HTTPException(404, "Workspace not found")

    if user.role == Role.superadmin:
        # Superadmin always gets owner-level access regardless of actual membership
        return WorkspaceMember(
            workspace_id=workspace_id,
            user_id=user.id,
            role=WorkspaceMemberRole.owner,
            status=WorkspaceMemberStatus.active,
        )

    mem_res = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    member = mem_res.scalar_one_or_none()
    if not member:
        raise HTTPException(403, "Not a member of this workspace")
    if require_active and member.status != WorkspaceMemberStatus.active:
        raise HTTPException(403, "Membership is not active")
    return member


def _require_admin_or_owner(member: WorkspaceMember) -> None:
    if member.role not in (WorkspaceMemberRole.owner, WorkspaceMemberRole.admin):
        raise HTTPException(403, "Owner or admin role required")


def _require_owner(member: WorkspaceMember) -> None:
    if member.role != WorkspaceMemberRole.owner:
        raise HTTPException(403, "Owner role required")


def _workspace_to_response(ws: Workspace, my_role: WorkspaceMemberRole | None) -> WorkspaceResponse:
    return WorkspaceResponse(
        id=ws.id,
        name=ws.name,
        slug=ws.slug,
        invite_code=ws.invite_code,
        timezone=ws.timezone,
        telegram_chat_id=ws.telegram_chat_id,
        created_at=ws.created_at,
        my_role=my_role,
    )


class MemberPatchBody(BaseModel):
    """Unified body for PATCH /workspaces/{ws_id}/members/{mid}.

    Accepts either:
      - {"approve": true|false}   — approve/reject pending member
      - {"role": "admin"|"member"} — change role (owner only)
      - profile fields            — edit user profile (admin/owner only)
    """
    approve: bool | None = None
    role: WorkspaceMemberRole | None = None
    first_name: str | None = None
    last_name: str | None = None
    position: str | None = None


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("", response_model=list[WorkspaceResponse])
async def list_my_workspaces(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WorkspaceResponse]:
    """Return workspaces for current user. Superadmin gets all workspaces."""
    if current_user.role == Role.superadmin:
        # Load all workspaces with membership if exists
        all_ws = await db.execute(
            select(Workspace)
            .where(Workspace.archived_at.is_(None))
            .order_by(Workspace.created_at.desc())
        )
        workspaces = all_ws.scalars().all()
        # Load user's own memberships for role lookup
        mem_res = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.user_id == current_user.id,
                WorkspaceMember.status == WorkspaceMemberStatus.active,
            )
        )
        my_memberships = {m.workspace_id: m.role for m in mem_res.scalars().all()}
        return [
            _workspace_to_response(ws, my_memberships.get(ws.id, WorkspaceMemberRole.owner))
            for ws in workspaces
        ]

    result = await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            WorkspaceMember.user_id == current_user.id,
            WorkspaceMember.status == WorkspaceMemberStatus.active,
            Workspace.archived_at.is_(None),
        )
        .order_by(Workspace.created_at.desc())
    )
    rows = result.all()
    return [_workspace_to_response(ws, role) for ws, role in rows]


@router.post("", response_model=WorkspaceResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    payload: WorkspaceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceResponse:
    """Create a new workspace. Creator becomes the owner."""
    slug = await _generate_unique_slug(payload.name, db)
    invite_code = _generate_invite_code()

    ws = Workspace(
        name=payload.name,
        slug=slug,
        invite_code=invite_code,
        timezone=payload.timezone,
        created_by_user_id=current_user.id,
    )
    db.add(ws)
    await db.flush()

    owner_member = WorkspaceMember(
        workspace_id=ws.id,
        user_id=current_user.id,
        role=WorkspaceMemberRole.owner,
        status=WorkspaceMemberStatus.active,
    )
    db.add(owner_member)
    await db.commit()
    await db.refresh(ws)

    return _workspace_to_response(ws, WorkspaceMemberRole.owner)


@router.get("/search", response_model=list[WorkspaceResponse])
async def search_workspaces(
    q: str = Query(..., min_length=1, max_length=100, description="Search by workspace name"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[WorkspaceResponse]:
    """Case-insensitive search of non-archived workspaces by name (limit 20)."""
    pattern = f"%{q.lower()}%"
    result = await db.execute(
        select(Workspace)
        .where(
            Workspace.archived_at.is_(None),
            Workspace.name.ilike(pattern),
        )
        .order_by(Workspace.name)
        .limit(20)
    )
    workspaces = result.scalars().all()
    return [_workspace_to_response(ws, None) for ws in workspaces]


@router.post("/join", response_model=WorkspaceMemberResponse, status_code=status.HTTP_201_CREATED)
async def join_workspace(
    payload: JoinRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceMemberResponse:
    """Request to join a workspace using its invite_code. Creates a pending member."""
    ws_res = await db.execute(
        select(Workspace).where(
            Workspace.invite_code == payload.invite_code,
            Workspace.archived_at.is_(None),
        )
    )
    workspace = ws_res.scalar_one_or_none()
    if not workspace:
        raise HTTPException(404, "Workspace with this invite code not found")

    existing_res = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == current_user.id,
        )
    )
    existing = existing_res.scalar_one_or_none()
    if existing:
        raise HTTPException(409, "You are already a member or have a pending request")

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=current_user.id,
        role=WorkspaceMemberRole.member,
        status=WorkspaceMemberStatus.pending,
    )
    db.add(member)
    await db.commit()

    res = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.id == member.id)
    )
    return res.scalar_one()


@router.get("/{ws_id}", response_model=WorkspaceDetailResponse)
async def get_workspace(
    ws_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceDetailResponse:
    """Return workspace details with member lists (must be active member)."""
    my_membership = await _get_my_membership(ws_id, current_user, db)

    ws_res = await db.execute(
        select(Workspace)
        .options(selectinload(Workspace.members).selectinload(WorkspaceMember.user))
        .where(Workspace.id == ws_id)
    )
    workspace = ws_res.scalar_one()

    is_admin_or_owner = my_membership.role in (WorkspaceMemberRole.owner, WorkspaceMemberRole.admin)

    active_members = [m for m in workspace.members if m.status == WorkspaceMemberStatus.active]
    pending_members = (
        [m for m in workspace.members if m.status == WorkspaceMemberStatus.pending]
        if is_admin_or_owner else []
    )

    base = _workspace_to_response(workspace, my_membership.role)
    return WorkspaceDetailResponse(
        **base.model_dump(),
        members=[WorkspaceMemberResponse.model_validate(m) for m in active_members],
        pending_members=[WorkspaceMemberResponse.model_validate(m) for m in pending_members],
    )


@router.patch("/{ws_id}", response_model=WorkspaceResponse)
async def update_workspace(
    ws_id: int,
    payload: WorkspaceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceResponse:
    """Update workspace name/timezone (owner/admin only)."""
    member = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(member)

    ws_res = await db.execute(select(Workspace).where(Workspace.id == ws_id))
    workspace = ws_res.scalar_one()

    if payload.name is not None:
        workspace.name = payload.name
    if payload.timezone is not None:
        workspace.timezone = payload.timezone
    if payload.telegram_chat_id is not None:
        workspace.telegram_chat_id = payload.telegram_chat_id

    await db.commit()
    await db.refresh(workspace)
    return _workspace_to_response(workspace, member.role)


@router.delete("/{ws_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_workspace(
    ws_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Archive workspace (soft delete). Owner only."""
    member = await _get_my_membership(ws_id, current_user, db)
    _require_owner(member)

    ws_res = await db.execute(select(Workspace).where(Workspace.id == ws_id))
    workspace = ws_res.scalar_one()
    workspace.archived_at = datetime.now(timezone.utc)

    await db.commit()


@router.post("/{ws_id}/regenerate-code", response_model=WorkspaceResponse)
async def regenerate_invite_code(
    ws_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceResponse:
    """Generate a new invite code for the workspace (owner/admin only)."""
    member = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(member)

    ws_res = await db.execute(select(Workspace).where(Workspace.id == ws_id))
    workspace = ws_res.scalar_one()
    workspace.invite_code = _generate_invite_code()

    await db.commit()
    await db.refresh(workspace)
    return _workspace_to_response(workspace, member.role)


@router.get("/{ws_id}/members", response_model=list[WorkspaceMemberResponse])
async def list_members(
    ws_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WorkspaceMemberResponse]:
    """List members. Active members visible to all; pending members only to owner/admin."""
    my_membership = await _get_my_membership(ws_id, current_user, db)

    is_admin_or_owner = my_membership.role in (WorkspaceMemberRole.owner, WorkspaceMemberRole.admin)

    conditions = [WorkspaceMember.workspace_id == ws_id]
    if is_admin_or_owner:
        conditions.append(
            WorkspaceMember.status.in_(
                [WorkspaceMemberStatus.active, WorkspaceMemberStatus.pending]
            )
        )
    else:
        conditions.append(WorkspaceMember.status == WorkspaceMemberStatus.active)

    result = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(and_(*conditions))
        .order_by(WorkspaceMember.created_at)
    )
    return list(result.scalars().all())


@router.post(
    "/{ws_id}/invite",
    response_model=WorkspaceMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_member(
    ws_id: int,
    payload: InviteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceMemberResponse:
    """Invite a user by username (owner/admin only).

    If the user exists in the DB, creates an active member directly.
    If not, creates a pending member by `pending_username` so they can be linked when registering.
    """
    member = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(member)

    username = payload.username.strip().lstrip("@")
    if not username:
        raise HTTPException(400, "Username cannot be empty")

    user_res = await db.execute(select(User).where(User.username == username))
    target_user = user_res.scalar_one_or_none()

    invite_token = secrets.token_urlsafe(16)

    if target_user:
        existing_res = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == ws_id,
                WorkspaceMember.user_id == target_user.id,
            )
        )
        if existing_res.scalar_one_or_none():
            raise HTTPException(409, "User is already a member or has a pending invitation")

        new_member = WorkspaceMember(
            workspace_id=ws_id,
            user_id=target_user.id,
            role=WorkspaceMemberRole.member,
            status=WorkspaceMemberStatus.pending,
            invited_by_user_id=current_user.id,
            invite_token=invite_token,
        )
    else:
        existing_res = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == ws_id,
                WorkspaceMember.pending_username == username,
                WorkspaceMember.user_id.is_(None),
            )
        )
        if existing_res.scalar_one_or_none():
            raise HTTPException(409, "An invitation for this username already exists")

        new_member = WorkspaceMember(
            workspace_id=ws_id,
            user_id=None,
            pending_username=username,
            role=WorkspaceMemberRole.member,
            status=WorkspaceMemberStatus.pending,
            invited_by_user_id=current_user.id,
            invite_token=invite_token,
        )

    db.add(new_member)
    await db.commit()

    res = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.id == new_member.id)
    )
    member = res.scalar_one()
    response = WorkspaceMemberResponse.model_validate(member)
    response.invite_deep_link = (
        f"https://t.me/{settings.TG_BOT_USERNAME}?start=invite_{invite_token}"
    )
    return response


@router.patch("/{ws_id}/members/{mid}", response_model=WorkspaceMemberResponse | None)
async def update_member(
    ws_id: int,
    mid: int,
    payload: MemberPatchBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceMemberResponse | None:
    """Approve/reject pending members or change roles.

    Unified body:
      - `approve: true`  → set status=active
      - `approve: false` → delete the membership row (reject)
      - `role: "admin"`  → owner-only: change role of admins/members

    Returns the updated member, or `null` if the row was deleted.
    """
    my_membership = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(my_membership)

    mem_res = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.id == mid, WorkspaceMember.workspace_id == ws_id)
    )
    target = mem_res.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Member not found")

    if payload.approve is not None:
        # Approve or reject a pending request
        if target.status != WorkspaceMemberStatus.pending:
            raise HTTPException(400, "Member is not in pending state")

        if payload.approve:
            target.status = WorkspaceMemberStatus.active
            await db.commit()
            res = await db.execute(
                select(WorkspaceMember)
                .options(selectinload(WorkspaceMember.user))
                .where(WorkspaceMember.id == target.id)
            )
            return res.scalar_one()
        else:
            await db.delete(target)
            await db.commit()
            return None

    if payload.role is not None:
        # Change role — owner-only (superadmin can also do ownership transfers)
        if my_membership.role != WorkspaceMemberRole.owner:
            raise HTTPException(403, "Only the owner can change member roles")

        # Only superadmin can change the role of the current owner
        if target.role == WorkspaceMemberRole.owner and current_user.role != Role.superadmin:
            raise HTTPException(403, "Only superadmin can change the owner's role")

        # Ownership transfer: demote current owner to admin first
        if payload.role == WorkspaceMemberRole.owner:
            if current_user.role != Role.superadmin:
                raise HTTPException(403, "Only superadmin can transfer ownership")
            cur_owner_res = await db.execute(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == ws_id,
                    WorkspaceMember.role == WorkspaceMemberRole.owner,
                    WorkspaceMember.id != target.id,
                )
            )
            cur_owner = cur_owner_res.scalar_one_or_none()
            if cur_owner:
                cur_owner.role = WorkspaceMemberRole.admin

        target.role = payload.role
        await db.commit()
        res = await db.execute(
            select(WorkspaceMember)
            .options(selectinload(WorkspaceMember.user))
            .where(WorkspaceMember.id == target.id)
        )
        return res.scalar_one()

    if any(v is not None for v in [payload.first_name, payload.last_name, payload.position]):
        if my_membership.role not in (WorkspaceMemberRole.owner, WorkspaceMemberRole.admin):
            raise HTTPException(403, "Only admins can edit user profiles")
        user = target.user
        if user:
            if payload.first_name is not None:
                user.first_name = payload.first_name
            if payload.last_name is not None:
                user.last_name = payload.last_name
            if payload.position is not None:
                user.position = payload.position
            await db.commit()
        res = await db.execute(
            select(WorkspaceMember)
            .options(selectinload(WorkspaceMember.user))
            .where(WorkspaceMember.id == target.id)
        )
        return res.scalar_one()

    raise HTTPException(400, "Body must contain either `approve` or `role`")


@router.delete("/{ws_id}/members/{mid}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    ws_id: int,
    mid: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove a member from the workspace (owner/admin only).

    - Owner cannot remove themselves (transfer ownership first — not implemented).
    - Admin cannot remove the owner.
    """
    my_membership = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(my_membership)

    mem_res = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.id == mid,
            WorkspaceMember.workspace_id == ws_id,
        )
    )
    target = mem_res.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Member not found")

    if target.role == WorkspaceMemberRole.owner:
        raise HTTPException(400, "Cannot remove the workspace owner")

    if target.user_id == current_user.id and my_membership.role == WorkspaceMemberRole.owner:
        raise HTTPException(400, "Owner cannot remove themselves")

    await db.delete(target)
    await db.commit()


@router.get("/{ws_id}/analytics")
async def get_workspace_analytics(
    ws_id: int,
    period_days: int = Query(default=30, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    my_membership = await _get_my_membership(ws_id, current_user, db)
    if my_membership.role not in (WorkspaceMemberRole.owner, WorkspaceMemberRole.admin):
        raise HTTPException(403, "Admin or owner only")

    since = datetime.now(timezone.utc) - timedelta(days=period_days)

    total_members = (await db.execute(
        select(func.count(WorkspaceMember.id)).where(
            WorkspaceMember.workspace_id == ws_id,
            WorkspaceMember.status == WorkspaceMemberStatus.active,
        )
    )).scalar_one()

    total_meetings = (await db.execute(
        select(func.count(Booking.id)).where(
            Booking.workspace_id == ws_id,
            Booking.deleted_at.is_(None),
            Booking.start_time >= since,
        )
    )).scalar_one()

    # New members per day
    members_by_day_res = await db.execute(
        select(
            func.date(WorkspaceMember.created_at).label("day"),
            func.count(WorkspaceMember.id).label("cnt"),
        )
        .where(
            WorkspaceMember.workspace_id == ws_id,
            WorkspaceMember.created_at >= since,
        )
        .group_by(func.date(WorkspaceMember.created_at))
        .order_by(func.date(WorkspaceMember.created_at))
    )
    new_members = [{"date": str(r.day), "count": r.cnt} for r in members_by_day_res.all()]

    # Meetings per day
    meetings_by_day_res = await db.execute(
        select(
            func.date(Booking.start_time).label("day"),
            func.count(Booking.id).label("cnt"),
        )
        .where(
            Booking.workspace_id == ws_id,
            Booking.deleted_at.is_(None),
            Booking.start_time >= since,
        )
        .group_by(func.date(Booking.start_time))
        .order_by(func.date(Booking.start_time))
    )
    meetings_by_day = [{"date": str(r.day), "count": r.cnt} for r in meetings_by_day_res.all()]

    # Top organizers
    top_res = await db.execute(
        select(
            User.id,
            User.first_name,
            User.last_name,
            User.username,
            func.count(Booking.id).label("cnt"),
        )
        .join(Booking, Booking.user_id == User.id)
        .where(
            Booking.workspace_id == ws_id,
            Booking.deleted_at.is_(None),
            Booking.start_time >= since,
        )
        .group_by(User.id, User.first_name, User.last_name, User.username)
        .order_by(func.count(Booking.id).desc())
        .limit(10)
    )
    top_organizers = [
        {
            "user_id": r.id,
            "user_name": f"{r.first_name or ''} {r.last_name or ''}".strip() or r.username or f"user-{r.id}",
            "count": r.cnt,
        }
        for r in top_res.all()
    ]

    return {
        "period_days": period_days,
        "total_members": total_members,
        "total_meetings": total_meetings,
        "new_members": new_members,
        "meetings_by_day": meetings_by_day,
        "top_organizers": top_organizers,
    }
