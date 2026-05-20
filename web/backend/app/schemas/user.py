from pydantic import BaseModel, computed_field


class UserResponse(BaseModel):
    id: int
    telegram_id: int | None = None
    name: str | None = None
    first_name: str | None
    last_name: str | None
    username: str | None
    role: str
    language_code: str | None = None
    avatar: str | None = None
    position: str | None = None
    default_reminder_minutes: int = 15

    @computed_field
    @property
    def display_name(self) -> str:
        if self.first_name:
            name = self.first_name
            if self.last_name:
                name = f"{name} {self.last_name}"
            return name
        n: str = self.name or ""
        return n or f"user_{self.id}"

    class Config:
        from_attributes = True


class UserPublicResponse(BaseModel):
    """Public user info — excludes telegram_id and internal fields."""
    id: int
    first_name: str | None
    last_name: str | None
    username: str | None
    role: str
    avatar: str | None = None
    position: str | None = None

    @computed_field
    @property
    def display_name(self) -> str:
        if self.first_name:
            name = self.first_name
            if self.last_name:
                name = f"{name} {self.last_name}"
            return name
        return f"user_{self.id}"

    class Config:
        from_attributes = True
