import enum
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Role(str, enum.Enum):
    user = "user"
    admin = "admin"
    superadmin = "superadmin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    telegram_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, index=True, nullable=True)
    # Legacy field — kept for compatibility with tg/ part
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.user, server_default="user")
    language_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_registered: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    feed_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    avatar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    position: Mapped[str | None] = mapped_column(String(100), nullable=True)
    default_reminder_minutes: Mapped[int] = mapped_column(Integer, default=15, server_default="15")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    bookings: Mapped[list["Booking"]] = relationship(  # noqa: F821
        "Booking", back_populates="user", cascade="all, delete-orphan"
    )
    browser_sessions: Mapped[list["BrowserSession"]] = relationship(  # noqa: F821
        "BrowserSession", back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def display_name(self) -> str:
        if self.first_name:
            parts = [self.first_name]
            if self.last_name:
                parts.append(self.last_name)
            return " ".join(parts)
        return self.name or f"user_{self.id}"
