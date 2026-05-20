from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking
from app.schemas.slot import SlotResponse

SLOT_MINUTES = 30
DAY_START = time(7, 0)
DAY_END = time(22, 0)


async def get_slots(target_date: date, db: AsyncSession) -> list[SlotResponse]:
    """Return 30-min slots for a day with availability flag."""
    day_start = datetime.combine(target_date, DAY_START).replace(tzinfo=timezone.utc)
    day_end = datetime.combine(target_date, DAY_END).replace(tzinfo=timezone.utc)

    result = await db.execute(
        select(Booking).where(
            and_(
                Booking.start_time < day_end,
                Booking.end_time > day_start,
                Booking.deleted_at.is_(None),
            )
        )
    )
    bookings = result.scalars().all()

    slots: list[SlotResponse] = []
    current = day_start
    while current < day_end:
        slot_end = current + timedelta(minutes=SLOT_MINUTES)
        occupied = any(b.start_time < slot_end and b.end_time > current for b in bookings)
        slots.append(
            SlotResponse(
                start=current.strftime("%H:%M"),
                end=slot_end.strftime("%H:%M"),
                available=not occupied,
            )
        )
        current = slot_end

    return slots
