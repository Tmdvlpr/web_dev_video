import enum
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BookingType(str, enum.Enum):
    physical = "physical"
    virtual  = "virtual"
    hybrid   = "hybrid"


class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    prev_start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    prev_end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    guests: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    recurrence: Mapped[str] = mapped_column(String(10), nullable=False, default="none", server_default="none")
    recurrence_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    recurrence_group_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    recurrence_days: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    reminder_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True)
    room_id: Mapped[int | None] = mapped_column(ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    video_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    video_room_name: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True, index=True)
    booking_type: Mapped[BookingType] = mapped_column(
        Enum(BookingType), nullable=False, default=BookingType.physical, server_default="physical"
    )

    user: Mapped["User"] = relationship("User", back_populates="bookings")  # noqa: F821
    workspace: Mapped["Workspace | None"] = relationship("Workspace")  # noqa: F821
    room: Mapped["Room | None"] = relationship("Room")  # noqa: F821
