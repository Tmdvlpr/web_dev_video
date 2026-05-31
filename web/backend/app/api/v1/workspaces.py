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
    WorkspacePosition,
)
from app.schemas.workspace import (
    JoinRequest,
    RebindRequest,
    WorkspaceCreate,
    WorkspaceDetailResponse,
    WorkspaceMemberResponse,
    WorkspacePositionCreate,
    WorkspacePositionResponse,
    WorkspacePositionUpdate,
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
    """Generate a URL-safe invite code (128 bits of entropy, ~22 chars)."""
    return secrets.token_urlsafe(16)


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
    tg_invite_link = None
    if settings.TG_BOT_USERNAME:
        tg_invite_link = f"https://t.me/{settings.TG_BOT_USERNAME}?start=ws_{ws.invite_code}"
    return WorkspaceResponse(
        id=ws.id,
        name=ws.name,
        slug=ws.slug,
        invite_code=ws.invite_code,
        timezone=ws.timezone,
        telegram_chat_id=ws.telegram_chat_id,
        created_at=ws.created_at,
        my_role=my_role,
        tg_invite_link=tg_invite_link,
    )


class MemberPatchBody(BaseModel):
    """Unified body for PATCH /workspaces/{ws_id}/members/{mid}.

    Accepts either:
      - {"approve": true|false}   — approve/reject pending member
      - {"role": "admin"|"member"} — change role (owner only)
      - profile fields            — edit user profile (admin/owner only)
      - {"position_id": N|null}   — assign workspace position (admin/owner only)
    """
    approve: bool | None = None
    role: WorkspaceMemberRole | None = None
    first_name: str | None = None
    last_name: str | None = None
    position: str | None = None
    position_id: int | None = None


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
            _workspace_to_response(ws, WorkspaceMemberRole.owner)
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
        status=WorkspaceMemberStatus.active,
    )
    db.add(member)
    await db.commit()

    res = await db.execute(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user), selectinload(WorkspaceMember.position))
        .where(WorkspaceMember.id == member.id)
    )
    return res.scalar_one()


class ClaimInviteWebRequest(BaseModel):
    invite_token: str


@router.post("/claim-invite", response_model=WorkspaceMemberResponse)
async def claim_invite_web(
    payload: ClaimInviteWebRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceMemberResponse:
    """Claim an anonymous personal invite link for the currently authenticated user."""
    member = await db.scalar(
        select(WorkspaceMember).where(WorkspaceMember.invite_token == payload.invite_token)
    )
    if not member:
        raise HTTPException(404, "Invite not found or already used")
    if member.status != WorkspaceMemberStatus.pending:
        raise HTTPException(400, "Invite already used")
    if member.invite_expires_at and member.invite_expires_at < datetime.now(timezone.utc):
        await db.delete(member)
        await db.commit()
        raise HTTPException(410, "Invite link has expired")

    # Check if user is already a member
    existing = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == member.workspace_id,
            WorkspaceMember.user_id == current_user.id,
            WorkspaceMember.id != member.id,
        )
    )
    if existing:
        await db.delete(member)
        await db.commit()
        res = await db.execute(
            select(WorkspaceMember).options(selectinload(WorkspaceMember.user), selectinload(WorkspaceMember.position)).where(WorkspaceMember.id == existing.id)
        )
        return res.scalar_one()

    member.user_id = current_user.id
    member.pending_username = None
    member.status = WorkspaceMemberStatus.active
    member.invite_token = None
    await db.commit()
    res = await db.execute(
        select(WorkspaceMember).options(selectinload(WorkspaceMember.user), selectinload(WorkspaceMember.position)).where(WorkspaceMember.id == member.id)
    )
    return res.scalar_one()


def _build_pending_responses(members: list) -> list[WorkspaceMemberResponse]:
    results = []
    for m in members:
        r = WorkspaceMemberResponse.model_validate(m)
        if settings.TG_BOT_USERNAME and m.invite_token:
            r.invite_deep_link = f"https://t.me/{settings.TG_BOT_USERNAME}?start=invite_{m.invite_token}"
        results.append(r)
    return results


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
        .options(selectinload(Workspace.members).options(selectinload(WorkspaceMember.user), selectinload(WorkspaceMember.position)))
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
        pending_members=_build_pending_responses(pending_members),
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


@router.post("/{ws_id}/rebind", response_model=WorkspaceResponse)
async def rebind_workspace_telegram(
    ws_id: int,
    payload: RebindRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceResponse:
    """Атомарно перепривязывает или отвязывает воркспейс от TG-чата. Owner/admin."""
    member = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(member)

    ws_res = await db.execute(select(Workspace).where(Workspace.id == ws_id))
    workspace = ws_res.scalar_one()
    workspace.telegram_chat_id = payload.chat_id
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
    """Generate a new invite code for the workspace (owner/superadmin only)."""
    member = await _get_my_membership(ws_id, current_user, db)
    _require_owner(member)

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
        .options(selectinload(WorkspaceMember.user), selectinload(WorkspaceMember.position))
        .where(and_(*conditions))
        .order_by(WorkspaceMember.created_at)
    )
    members = list(result.scalars().all())
    now = datetime.now(timezone.utc)
    responses = []
    deleted_any = False
    for m in members:
        # Auto-cleanup expired anonymous invites
        if (
            m.status == WorkspaceMemberStatus.pending
            and m.user_id is None
            and m.pending_username is None
            and m.invite_expires_at is not None
            and m.invite_expires_at < now
        ):
            await db.delete(m)
            deleted_any = True
            continue
        r = WorkspaceMemberResponse.model_validate(m)
        if settings.TG_BOT_USERNAME and m.status == WorkspaceMemberStatus.pending and m.invite_token:
            r.invite_deep_link = f"https://t.me/{settings.TG_BOT_USERNAME}?start=invite_{m.invite_token}"
        responses.append(r)
    if deleted_any:
        await db.commit()
    return responses


@router.post(
    "/{ws_id}/generate-invite-link",
    response_model=WorkspaceMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def generate_invite_link(
    ws_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceMemberResponse:
    """Generate a one-time personal invite link without requiring a username (owner/admin only)."""
    member = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(member)

    # Delete existing unclaimed anonymous invites for this workspace
    old_invites = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ws_id,
            WorkspaceMember.status == WorkspaceMemberStatus.pending,
            WorkspaceMember.user_id.is_(None),
            WorkspaceMember.pending_username.is_(None),
            WorkspaceMember.invite_token.is_not(None),
        )
    )
    for old in old_invites.scalars().all():
        await db.delete(old)

    invite_token = secrets.token_urlsafe(16)
    invite_expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    new_member = WorkspaceMember(
        workspace_id=ws_id,
        user_id=None,
        pending_username=None,
        role=WorkspaceMemberRole.member,
        status=WorkspaceMemberStatus.pending,
        invited_by_user_id=current_user.id,
        invite_token=invite_token,
        invite_expires_at=invite_expires_at,
    )
    db.add(new_member)
    await db.commit()
    await db.refresh(new_member)

    r = WorkspaceMemberResponse.model_validate(new_member)
    if settings.TG_BOT_USERNAME:
        r.invite_deep_link = f"https://t.me/{settings.TG_BOT_USERNAME}?start=invite_{invite_token}"
    return r


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
        .options(selectinload(WorkspaceMember.user), selectinload(WorkspaceMember.position))
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
            if target.user_id is None and not target.pending_username:
                raise HTTPException(400, "Anonymous invite must be claimed via Telegram bot, not approved manually")
            target.status = WorkspaceMemberStatus.active
            await db.commit()
            res = await db.execute(
                select(WorkspaceMember)
                .options(selectinload(WorkspaceMember.user), selectinload(WorkspaceMember.position))
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
            .options(selectinload(WorkspaceMember.user), selectinload(WorkspaceMember.position))
            .where(WorkspaceMember.id == target.id)
        )
        return res.scalar_one()

    has_profile_fields = any(v is not None for v in [payload.first_name, payload.last_name, payload.position])
    has_position_id = "position_id" in payload.model_fields_set
    if has_profile_fields or has_position_id:
        is_admin_or_owner = my_membership.role in (WorkspaceMemberRole.owner, WorkspaceMemberRole.admin)
        is_self = target.user_id == current_user.id

        # Profile fields (name) — admin/owner only
        if has_profile_fields and not is_admin_or_owner:
            raise HTTPException(403, "Only admins can edit user profiles")
        # position_id — admin/owner can assign to anyone; members can only self-assign
        if has_position_id and not is_admin_or_owner and not is_self:
            raise HTTPException(403, "You can only change your own position")

        if has_position_id:
            if payload.position_id is not None:
                pos_check = await db.scalar(
                    select(WorkspacePosition).where(
                        WorkspacePosition.id == payload.position_id,
                        WorkspacePosition.workspace_id == ws_id,
                    )
                )
                if not pos_check:
                    raise HTTPException(404, "Position not found in this workspace")
            target.position_id = payload.position_id

        user = target.user
        if user and has_profile_fields:
            if payload.first_name is not None:
                user.first_name = payload.first_name
            if payload.last_name is not None:
                user.last_name = payload.last_name
            if payload.position is not None:
                user.position = payload.position
        await db.commit()
        res = await db.execute(
            select(WorkspaceMember)
            .options(selectinload(WorkspaceMember.user), selectinload(WorkspaceMember.position))
            .where(WorkspaceMember.id == target.id)
        )
        return res.scalar_one()

    raise HTTPException(400, "Body must contain a valid field to update")


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


@router.get("/{ws_id}/positions", response_model=list[WorkspacePositionResponse])
async def list_positions(
    ws_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WorkspacePositionResponse]:
    """List all positions defined for this workspace (visible to all active members)."""
    await _get_my_membership(ws_id, current_user, db)
    result = await db.execute(
        select(WorkspacePosition)
        .where(WorkspacePosition.workspace_id == ws_id)
        .order_by(WorkspacePosition.id)
    )
    return list(result.scalars().all())


@router.post("/{ws_id}/positions", response_model=WorkspacePositionResponse, status_code=status.HTTP_201_CREATED)
async def create_position(
    ws_id: int,
    payload: WorkspacePositionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspacePositionResponse:
    """Create a new position for this workspace (admin/owner only)."""
    member = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(member)

    pos = WorkspacePosition(
        workspace_id=ws_id,
        name_ru=payload.name_ru,
        name_uz=payload.name_uz,
    )
    db.add(pos)
    await db.commit()
    await db.refresh(pos)
    return pos


@router.patch("/{ws_id}/positions/{pos_id}", response_model=WorkspacePositionResponse)
async def update_position(
    ws_id: int,
    pos_id: int,
    payload: WorkspacePositionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspacePositionResponse:
    """Update a workspace position's name(s) (admin/owner only)."""
    member = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(member)

    pos = await db.scalar(
        select(WorkspacePosition).where(
            WorkspacePosition.id == pos_id,
            WorkspacePosition.workspace_id == ws_id,
        )
    )
    if not pos:
        raise HTTPException(404, "Position not found")

    if payload.name_ru is not None:
        pos.name_ru = payload.name_ru
    if payload.name_uz is not None:
        pos.name_uz = payload.name_uz

    await db.commit()
    await db.refresh(pos)
    return pos


@router.delete("/{ws_id}/positions/{pos_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_position(
    ws_id: int,
    pos_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a workspace position (admin/owner only). Members with this position get position_id=null."""
    member = await _get_my_membership(ws_id, current_user, db)
    _require_admin_or_owner(member)

    pos = await db.scalar(
        select(WorkspacePosition).where(
            WorkspacePosition.id == pos_id,
            WorkspacePosition.workspace_id == ws_id,
        )
    )
    if not pos:
        raise HTTPException(404, "Position not found")

    await db.delete(pos)
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
