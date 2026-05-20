from pydantic import BaseModel


class SlotResponse(BaseModel):
    start: str   # "09:00"
    end: str     # "09:30"
    available: bool
