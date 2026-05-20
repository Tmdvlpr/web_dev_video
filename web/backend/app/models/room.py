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


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    workspace_rooms: Mapped[list["WorkspaceRoom"]] = relationship("WorkspaceRoom", back_populates="room", cascade="all, delete-orphan")


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
