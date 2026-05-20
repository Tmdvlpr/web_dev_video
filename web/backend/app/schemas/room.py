from datetime import datetime
from pydantic import BaseModel, Field
from app.models.room import WorkspaceRoomRole, RoomVisibility


class RoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)
    workspace_id: int  # which workspace this room belongs to (must be admin/owner there)


class RoomUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)


class RoomVisibilityUpdate(BaseModel):
    visibility: RoomVisibility


class ShareRoomRequest(BaseModel):
    target_workspace_invite_code: str  # invite code of workspace to share with


class RoomResponse(BaseModel):
    id: int
    name: str
    description: str | None
    archived_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class WorkspaceRoomResponse(BaseModel):
    id: int
    workspace_id: int
    room: RoomResponse
    role: WorkspaceRoomRole
    visibility: RoomVisibility
    created_at: datetime

    class Config:
        from_attributes = True
