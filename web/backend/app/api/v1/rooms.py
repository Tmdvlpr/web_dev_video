import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.booking import Booking
from app.models.room import Room, RoomJoinMode, RoomJoinRequest, RoomVisibility, WorkspaceRoom, WorkspaceRoomRole
from app.models.user import User
from app.models.workspace import (
    Workspace,
    WorkspaceMember,
    WorkspaceMemberRole,
    WorkspaceMemberStatus,
)
from app.schemas.room import (
    JoinRoomRequest,
    RoomCreate,
    RoomJoinRequestResponse,
    RoomUpdate,
    RoomVisibilityUpdate,
    ShareRoomRequest,
    WorkspaceRoomResponse,
)

router = APIRouter(prefix="/rooms", tags=["rooms"])


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _get_membership(
    workspace_id: int,
    user: User,
    db: AsyncSession,
    *,
    require_active: bool = True,
) -> WorkspaceMember:
    """Get user's membership in a workspace or raise 403/404."""
    ws_res = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id, Workspace.archived_at.is_(None))
    )
    if ws_res.scalar_one_or_none() is None:
        raise HTTPException(404, "Workspace not found")

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


async def _get_room_or_404(room_id: int, db: AsyncSession) -> Room:
    res = await db.execute(select(Room).where(Room.id == room_id))
    room = res.scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Room not found")
    return room


async def _list_user_workspace_ids(user: User, db: AsyncSession) -> list[int]:
    """Return all non-archived workspace ids where the user is an active member."""
    res = await db.execute(
        select(Workspace.id)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == WorkspaceMemberStatus.active,
            Workspace.archived_at.is_(None),
        )
    )
    return [row[0] for row in res.all()]


async def _user_has_access_to_room(
    room_id: int, user: User, db: AsyncSession
) -> WorkspaceRoom | None:
    """Return the WorkspaceRoom record by which the user has access, or None."""
    ws_ids = await _list_user_workspace_ids(user, db)
    if not ws_ids:
        return None
    res = await db.execute(
        select(WorkspaceRoom).where(
            WorkspaceRoom.room_id == room_id,
            WorkspaceRoom.workspace_id.in_(ws_ids),
        )
    )
    return res.scalars().first()


async def _get_owner_workspace_room(
    room_id: int, user: User, db: AsyncSession
) -> WorkspaceRoom:
    """Return WorkspaceRoom where the user has owner-role access to this room.
    Raises 403/404 otherwise."""
    ws_ids = await _list_user_workspace_ids(user, db)
    if not ws_ids:
        raise HTTPException(403, "No accessible workspace owns this room")

    res = await db.execute(
        select(WorkspaceRoom)
        .where(
            WorkspaceRoom.room_id == room_id,
            WorkspaceRoom.workspace_id.in_(ws_ids),
            WorkspaceRoom.role == WorkspaceRoomRole.owner,
        )
    )
    wr = res.scalars().first()
    if not wr:
        raise HTTPException(403, "You don't own this room in any of your workspaces")

    # Caller must additionally be admin/owner in that workspace
    mem_res = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == wr.workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    member = mem_res.scalar_one_or_none()
    if not member or member.role not in (WorkspaceMemberRole.owner, WorkspaceMemberRole.admin):
        raise HTTPException(403, "Admin/owner role required in the owning workspace")
    return wr


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("", response_model=list[WorkspaceRoomResponse])
async def list_my_rooms(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WorkspaceRoomResponse]:
    """List all rooms accessible via the user's active workspaces."""
    ws_ids = await _list_user_workspace_ids(current_user, db)
    if not ws_ids:
        return []

    res = await db.execute(
        select(WorkspaceRoom)
        .options(selectinload(WorkspaceRoom.room))
        .where(
            WorkspaceRoom.workspace_id.in_(ws_ids),
        )
        .order_by(WorkspaceRoom.created_at)
    )
    workspace_rooms = res.scalars().all()
    # Filter out archived rooms
    return [wr for wr in workspace_rooms if wr.room and wr.room.archived_at is None]


@router.post("", response_model=WorkspaceRoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
    payload: RoomCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceRoomResponse:
    """Create a room owned by `payload.workspace_id` (must be admin/owner there)."""
    member = await _get_membership(payload.workspace_id, current_user, db)
    _require_admin_or_owner(member)

    room = Room(
        name=payload.name,
        description=payload.description,
        created_by_user_id=current_user.id,
        invite_code=uuid.uuid4().hex[:8].upper(),
    )
    db.add(room)
    await db.flush()

    wr = WorkspaceRoom(
        workspace_id=payload.workspace_id,
        room_id=room.id,
        role=WorkspaceRoomRole.owner,
        visibility=RoomVisibility.full,
    )
    db.add(wr)
    await db.commit()

    res = await db.execute(
        select(WorkspaceRoom)
        .options(selectinload(WorkspaceRoom.room))
        .where(WorkspaceRoom.id == wr.id)
    )
    return res.scalar_one()


@router.get("/{room_id}", response_model=WorkspaceRoomResponse)
async def get_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceRoomResponse:
    """Return the WorkspaceRoom record by which the user accesses this room."""
    wr = await _user_has_access_to_room(room_id, current_user, db)
    if not wr:
        raise HTTPException(404, "Room not found or not accessible")

    res = await db.execute(
        select(WorkspaceRoom)
        .options(selectinload(WorkspaceRoom.room))
        .where(WorkspaceRoom.id == wr.id)
    )
    return res.scalar_one()


@router.patch("/{room_id}", response_model=WorkspaceRoomResponse)
async def update_room(
    room_id: int,
    payload: RoomUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceRoomResponse:
    """Update room name/description (owner workspace only)."""
    wr = await _get_owner_workspace_room(room_id, current_user, db)

    room = await _get_room_or_404(room_id, db)
    if payload.name is not None:
        room.name = payload.name
    if payload.description is not None:
        room.description = payload.description
    if payload.join_mode is not None:
        room.join_mode = payload.join_mode

    await db.commit()

    res = await db.execute(
        select(WorkspaceRoom)
        .options(selectinload(WorkspaceRoom.room))
        .where(WorkspaceRoom.id == wr.id)
    )
    return res.scalar_one()


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Soft-delete a room (set archived_at). Only the owner workspace can archive.
    Refuses to archive if there are future bookings on that room."""
    await _get_owner_workspace_room(room_id, current_user, db)
    room = await _get_room_or_404(room_id, db)
    if room.archived_at is not None:
        return  # already archived — idempotent

    now = datetime.now(timezone.utc)
    future_res = await db.execute(
        select(Booking.id).where(
            Booking.room_id == room_id,
            Booking.end_time > now,
            Booking.deleted_at.is_(None),
        ).limit(1)
    )
    if future_res.scalar_one_or_none() is not None:
        raise HTTPException(
            409,
            "Cannot archive room: there are future bookings on it. Cancel them first.",
        )

    room.archived_at = now
    await db.commit()


@router.post("/{room_id}/share", response_model=WorkspaceRoomResponse, status_code=status.HTTP_201_CREATED)
async def share_room(
    room_id: int,
    payload: ShareRoomRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceRoomResponse:
    """Share a room with another workspace (by its invite_code).
    Only the owner workspace can share."""
    await _get_owner_workspace_room(room_id, current_user, db)
    await _get_room_or_404(room_id, db)

    target_res = await db.execute(
        select(Workspace).where(
            Workspace.invite_code == payload.target_workspace_invite_code,
            Workspace.archived_at.is_(None),
        )
    )
    target_ws = target_res.scalar_one_or_none()
    if not target_ws:
        raise HTTPException(404, "Target workspace not found")

    # Already shared?
    existing_res = await db.execute(
        select(WorkspaceRoom).where(
            WorkspaceRoom.room_id == room_id,
            WorkspaceRoom.workspace_id == target_ws.id,
        )
    )
    if existing_res.scalar_one_or_none() is not None:
        raise HTTPException(409, "Room is already shared with this workspace")

    new_wr = WorkspaceRoom(
        workspace_id=target_ws.id,
        room_id=room_id,
        role=WorkspaceRoomRole.shared,
        visibility=RoomVisibility.full,
    )
    db.add(new_wr)
    await db.commit()

    res = await db.execute(
        select(WorkspaceRoom)
        .options(selectinload(WorkspaceRoom.room))
        .where(WorkspaceRoom.id == new_wr.id)
    )
    return res.scalar_one()


@router.delete("/{room_id}/share/{target_workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    room_id: int,
    target_workspace_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Revoke sharing of a room from a target workspace. Owner workspace only."""
    await _get_owner_workspace_room(room_id, current_user, db)

    res = await db.execute(
        select(WorkspaceRoom).where(
            WorkspaceRoom.room_id == room_id,
            WorkspaceRoom.workspace_id == target_workspace_id,
            WorkspaceRoom.role == WorkspaceRoomRole.shared,
        )
    )
    wr = res.scalar_one_or_none()
    if not wr:
        raise HTTPException(404, "Shared room link not found")

    await db.delete(wr)
    await db.commit()


@router.get("/{room_id}/join-requests", response_model=list[RoomJoinRequestResponse])
async def list_join_requests(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RoomJoinRequestResponse]:
    """List pending join requests for a room. Owner workspace admin/owner only."""
    await _get_owner_workspace_room(room_id, current_user, db)

    res = await db.execute(
        select(RoomJoinRequest)
        .options(
            selectinload(RoomJoinRequest.workspace),
            selectinload(RoomJoinRequest.requested_by),
        )
        .where(
            RoomJoinRequest.room_id == room_id,
            RoomJoinRequest.status == "pending",
        )
        .order_by(RoomJoinRequest.created_at)
    )
    requests = res.scalars().all()
    return [
        RoomJoinRequestResponse(
            id=r.id,
            room_id=r.room_id,
            workspace_id=r.workspace_id,
            workspace_name=r.workspace.name if r.workspace else str(r.workspace_id),
            requested_by=r.requested_by.display_name if r.requested_by else None,
            status=r.status,
            created_at=r.created_at,
        )
        for r in requests
    ]


@router.post("/{room_id}/join-requests/{request_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve_join_request(
    room_id: int,
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Approve a room join request. Creates WorkspaceRoom for the requesting workspace."""
    await _get_owner_workspace_room(room_id, current_user, db)

    res = await db.execute(
        select(RoomJoinRequest).where(
            RoomJoinRequest.id == request_id,
            RoomJoinRequest.room_id == room_id,
        )
    )
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Join request not found")

    existing = await db.execute(
        select(WorkspaceRoom).where(
            WorkspaceRoom.room_id == room_id,
            WorkspaceRoom.workspace_id == req.workspace_id,
        )
    )
    if not existing.scalar_one_or_none():
        wr = WorkspaceRoom(
            workspace_id=req.workspace_id,
            room_id=room_id,
            role=WorkspaceRoomRole.shared,
            visibility=RoomVisibility.full,
        )
        db.add(wr)

    req.status = "approved"
    await db.commit()


@router.post("/{room_id}/join-requests/{request_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_join_request(
    room_id: int,
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Reject a room join request."""
    await _get_owner_workspace_room(room_id, current_user, db)

    res = await db.execute(
        select(RoomJoinRequest).where(
            RoomJoinRequest.id == request_id,
            RoomJoinRequest.room_id == room_id,
        )
    )
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Join request not found")

    req.status = "rejected"
    await db.commit()


@router.post("/{room_id}/regenerate-code", response_model=WorkspaceRoomResponse)
async def regenerate_room_code(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceRoomResponse:
    """Generate a new invite code for a room. Owner workspace admin/owner only."""
    wr = await _get_owner_workspace_room(room_id, current_user, db)
    room = await _get_room_or_404(room_id, db)
    room.invite_code = uuid.uuid4().hex[:8].upper()
    await db.commit()

    res = await db.execute(
        select(WorkspaceRoom)
        .options(selectinload(WorkspaceRoom.room))
        .where(WorkspaceRoom.id == wr.id)
    )
    return res.scalar_one()


@router.patch("/{room_id}/workspaces/{workspace_id}/visibility", response_model=WorkspaceRoomResponse)
async def update_visibility(
    room_id: int,
    workspace_id: int,
    payload: RoomVisibilityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceRoomResponse:
    """Update visibility of a room within a specific workspace.
    Any workspace that has access can change its own visibility setting (admin/owner only)."""
    member = await _get_membership(workspace_id, current_user, db)
    _require_admin_or_owner(member)

    res = await db.execute(
        select(WorkspaceRoom).where(
            WorkspaceRoom.room_id == room_id,
            WorkspaceRoom.workspace_id == workspace_id,
        )
    )
    wr = res.scalar_one_or_none()
    if not wr:
        raise HTTPException(404, "Room is not accessible in this workspace")

    wr.visibility = payload.visibility
    await db.commit()

    res2 = await db.execute(
        select(WorkspaceRoom)
        .options(selectinload(WorkspaceRoom.room))
        .where(WorkspaceRoom.id == wr.id)
    )
    return res2.scalar_one()


@router.post("/join")
async def join_room_by_code(
    payload: JoinRoomRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    """Add a room to a workspace using the room's invite code. User must be admin/owner of the workspace.
    Returns 201 for instant join (open mode), 202 for approval-pending, 403 for closed mode."""
    member = await _get_membership(payload.workspace_id, current_user, db)
    _require_admin_or_owner(member)

    room_res = await db.execute(
        select(Room).where(Room.invite_code == payload.room_invite_code.upper().strip())
    )
    room = room_res.scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Room with this code not found")
    if room.archived_at is not None:
        raise HTTPException(410, "Room is archived")

    existing = await db.execute(
        select(WorkspaceRoom).where(
            WorkspaceRoom.workspace_id == payload.workspace_id,
            WorkspaceRoom.room_id == room.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Room already added to this workspace")

    join_mode = room.join_mode if room.join_mode else RoomJoinMode.approval

    if join_mode == RoomJoinMode.closed:
        raise HTTPException(403, "Подключение по коду отключено для этой комнаты")

    if join_mode == RoomJoinMode.open:
        wr = WorkspaceRoom(
            workspace_id=payload.workspace_id,
            room_id=room.id,
            role=WorkspaceRoomRole.shared,
            visibility=RoomVisibility.full,
        )
        db.add(wr)
        await db.commit()
        res = await db.execute(
            select(WorkspaceRoom)
            .options(selectinload(WorkspaceRoom.room))
            .where(WorkspaceRoom.id == wr.id)
        )
        wr_loaded = res.scalar_one()
        from app.schemas.room import WorkspaceRoomResponse
        return JSONResponse(
            status_code=201,
            content=WorkspaceRoomResponse.model_validate(wr_loaded).model_dump(mode="json"),
        )

    # approval mode — create or reuse pending request
    existing_req = await db.execute(
        select(RoomJoinRequest).where(
            RoomJoinRequest.room_id == room.id,
            RoomJoinRequest.workspace_id == payload.workspace_id,
        )
    )
    req = existing_req.scalar_one_or_none()
    if req and req.status == "pending":
        return JSONResponse(status_code=202, content={"status": "pending", "request_id": req.id})
    if req:
        req.status = "pending"
    else:
        req = RoomJoinRequest(
            room_id=room.id,
            workspace_id=payload.workspace_id,
            requested_by_user_id=current_user.id,
            status="pending",
        )
        db.add(req)
    await db.commit()
    await db.refresh(req)
    return JSONResponse(status_code=202, content={"status": "pending", "request_id": req.id})
