from datetime import datetime

from pydantic import BaseModel, Field, model_validator


# ── Guest invitation ───────────────────────────────────────────────────────────

class InviteLinkResponse(BaseModel):
    invite_url: str
    token: str


class GuestJoinInfo(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    status: str
    booking_id: int


class GuestRequestBody(BaseModel):
    guest_name: str = Field(..., min_length=1, max_length=128)


class AdmitGuestBody(BaseModel):
    invite_token: str
    action: str  # "approve" | "reject"


class InviteStatusResponse(BaseModel):
    status: str
    livekit_token: str | None = None
    livekit_url: str | None = None
    room_name: str | None = None


class MeetingJoinResponse(BaseModel):
    room_name: str
    livekit_url: str
    access_token: str
    user_identity: str
    start_time: datetime
    end_time: datetime
    is_organizer: bool = False
    e2ee_key: str = ""


class ChatFileResponse(BaseModel):
    id: int
    filename: str
    mime_type: str
    size: int
    created_at: datetime

    class Config:
        from_attributes = True


class ChatMessageCreate(BaseModel):
    body: str = Field(default="", max_length=2000)
    file_id: int | None = None

    @model_validator(mode="after")
    def at_least_body_or_file(self) -> "ChatMessageCreate":
        if not self.body.strip() and self.file_id is None:
            raise ValueError("Either body or file_id is required")
        return self


class ChatMessageResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    body: str
    file: ChatFileResponse | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class RecordingResponse(BaseModel):
    session_id: int
    room_name: str
    recording_path: str
    recording_duration_seconds: int | None = None
    started_at: datetime
    ended_at: datetime | None = None
