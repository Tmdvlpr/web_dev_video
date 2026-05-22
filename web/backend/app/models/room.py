import enum
from datetime import datetime
from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class WorkspaceRoomRole(str, enum.Enum):
    owner = "owner"
    shared = "shared"


class RoomVisibility(str, enum.Enum):
    full = "full"
    busy_only = "busy_only"


class RoomJoinMode(str, enum.Enum):
    open     = "open"      # мгновенное подключение по коду
    approval = "approval"  # требует одобрения (по умолчанию)
    closed   = "closed"    # подключение по коду отключено


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    invite_code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True, index=True)
    join_mode: Mapped[RoomJoinMode] = mapped_column(
        Enum(RoomJoinMode), nullable=False, default=RoomJoinMode.approval, server_default="approval"
    )
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    workspace_rooms: Mapped[list["WorkspaceRoom"]] = relationship("WorkspaceRoom", back_populates="room", cascade="all, delete-orphan")
    join_requests: Mapped[list["RoomJoinRequest"]] = relationship("RoomJoinRequest", back_populates="room", cascade="all, delete-orphan")


class WorkspaceRoom(Base):
    __tablename__ = "workspace_rooms"
    __table_args__ = (UniqueConstraint("workspace_id", "room_id", name="uq_workspace_room"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    role: Mapped[WorkspaceRoomRole] = mapped_column(Enum(WorkspaceRoomRole), default=WorkspaceRoomRole.owner, server_default="owner")
    visibility: Mapped[RoomVisibility] = mapped_column(Enum(RoomVisibility), default=RoomVisibility.full, server_default="full")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="workspace_rooms")
    room: Mapped["Room"] = relationship("Room", back_populates="workspace_rooms")


class RoomJoinRequest(Base):
    __tablename__ = "room_join_requests"
    __table_args__ = (UniqueConstraint("room_id", "workspace_id", name="uq_rjr_room_ws"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    requested_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    room: Mapped["Room"] = relationship("Room", back_populates="join_requests")
    workspace: Mapped["Workspace"] = relationship("Workspace")  # noqa: F821
    requested_by: Mapped["User | None"] = relationship("User")  # noqa: F821
