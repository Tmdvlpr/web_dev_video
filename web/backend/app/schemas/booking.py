from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.booking import BookingType
from app.schemas.user import UserPublicResponse


class BookingCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(None, max_length=2000)
    start_time: datetime
    end_time: datetime
    guests: list[str] = Field(default_factory=list)
    recurrence: Literal["none", "daily", "weekly", "custom"] = "none"
    recurrence_until: date | None = None
    recurrence_days: list[int] = Field(default_factory=list)
    reminder_minutes: int | None = Field(None, ge=1, le=1440)
    workspace_id: int | None = None
    room_id: int | None = None
    video_enabled: bool = False
    booking_type: BookingType = BookingType.physical

    @field_validator("guests")
    @classmethod
    def validate_guests(cls, v: list[str]) -> list[str]:
        if len(v) > 50:
            raise ValueError("Too many guests (max 50)")
        for g in v:
            if len(g) > 100:
                raise ValueError("Guest name too long (max 100 chars)")
        return v

    @field_validator("recurrence_days")
    @classmethod
    def validate_recurrence_days(cls, v: list[int]) -> list[int]:
        if len(v) > 7:
            raise ValueError("Too many recurrence days")
        for d in v:
            if d not in range(7):
                raise ValueError("Recurrence day must be 0–6")
        return v


class BookingUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=2000)
    start_time: datetime | None = None
    end_time: datetime | None = None
    guests: list[str] | None = None
    reminder_minutes: int | None = Field(None, ge=1, le=1440)
    video_enabled: bool | None = None
    booking_type: BookingType | None = None

    @field_validator("guests")
    @classmethod
    def validate_guests(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if len(v) > 50:
            raise ValueError("Too many guests (max 50)")
        for g in v:
            if len(g) > 100:
                raise ValueError("Guest name too long (max 100 chars)")
        return v


class BookingResponse(BaseModel):
    id: int
    title: str
    description: str | None
    start_time: datetime
    end_time: datetime
    user_id: int
    user: UserPublicResponse
    created_at: datetime
    guests: list[str] = []
    recurrence: str = "none"
    recurrence_until: date | None = None
    recurrence_group_id: int | None = None
    recurrence_days: list[int] = []
    reminder_minutes: int | None = None
    workspace_id: int | None = None
    room_id: int | None = None
    video_enabled: bool = False
    video_room_name: str | None = None
    booking_type: BookingType = BookingType.physical

    @field_validator("guests", mode="before")
    @classmethod
    def coerce_guests(cls, v: object) -> list[str]:
        if v is None:
            return []
        return [str(g) for g in v]

    @field_validator("recurrence_days", mode="before")
    @classmethod
    def coerce_recurrence_days(cls, v: object) -> list[int]:
        if v is None:
            return []
        try:
            return [int(d) for d in v if d is not None]
        except (TypeError, ValueError):
            return []

    class Config:
        from_attributes = True
