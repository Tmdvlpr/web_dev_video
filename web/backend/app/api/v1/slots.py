from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.slot import SlotResponse
from app.services.slot_service import get_slots

router = APIRouter(prefix="/slots", tags=["slots"])


@router.get("", response_model=list[SlotResponse])
async def list_slots(
    target_date: date = Query(alias="date", description="Date (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[SlotResponse]:
    return await get_slots(target_date, db)
