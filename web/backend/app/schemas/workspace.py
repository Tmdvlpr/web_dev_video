from datetime import datetime
from pydantic import BaseModel, Field
from app.models.workspace import WorkspaceMemberRole, WorkspaceMemberStatus
from app.schemas.user import UserPublicResponse


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    timezone: str = Field("UTC", max_length=50)


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    timezone: str | None = Field(None, max_length=50)
    telegram_chat_id: int | None = None


class WorkspaceMemberResponse(BaseModel):
    id: int
    workspace_id: int
    user_id: int | None
    pending_username: str | None
    role: WorkspaceMemberRole
    status: WorkspaceMemberStatus
    user: UserPublicResponse | None
    created_at: datetime
    invite_deep_link: str | None = None

    class Config:
        from_attributes = True


class WorkspaceResponse(BaseModel):
    id: int
    name: str
    slug: str
    invite_code: str
    timezone: str
    telegram_chat_id: int | None
    created_at: datetime
    my_role: WorkspaceMemberRole | None = None
    tg_invite_link: str | None = None

    class Config:
        from_attributes = True


class WorkspaceDetailResponse(WorkspaceResponse):
    members: list[WorkspaceMemberResponse] = []
    pending_members: list[WorkspaceMemberResponse] = []


class JoinRequest(BaseModel):
    invite_code: str


class InviteRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=255)


class UpdateMemberRole(BaseModel):
    role: WorkspaceMemberRole


class ApproveRequest(BaseModel):
    approve: bool
