import enum
from datetime import datetime
from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class WorkspaceMemberRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"


class WorkspaceMemberStatus(str, enum.Enum):
    active = "active"
    pending = "pending"


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100))
    slug: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    invite_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    timezone: Mapped[str] = mapped_column(String(50), default="UTC", server_default="UTC")
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    members: Mapped[list["WorkspaceMember"]] = relationship("WorkspaceMember", back_populates="workspace", cascade="all, delete-orphan")
    workspace_rooms: Mapped[list["WorkspaceRoom"]] = relationship("WorkspaceRoom", back_populates="workspace", cascade="all, delete-orphan")


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_member"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    pending_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[WorkspaceMemberRole] = mapped_column(Enum(WorkspaceMemberRole), default=WorkspaceMemberRole.member, server_default="member")
    status: Mapped[WorkspaceMemberStatus] = mapped_column(Enum(WorkspaceMemberStatus), default=WorkspaceMemberStatus.active, server_default="active")
    invited_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    invite_token: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True, index=True)
    invite_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="members")
    user: Mapped["User | None"] = relationship("User", foreign_keys=[user_id])  # noqa: F821
    invited_by: Mapped["User | None"] = relationship("User", foreign_keys=[invited_by_user_id])  # noqa: F821
