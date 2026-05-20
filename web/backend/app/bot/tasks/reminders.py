"""
Фоновая задача: каждые 60 секунд запрашивает у бэкенда встречи,
которые начнутся через 14-16 минут и ещё не получили напоминание.

Никаких прямых обращений к БД — только HTTP к бэкенду:
  GET  /api/v1/internal/bookings/reminders
  POST /api/v1/internal/bookings/{id}/mark-reminded
  GET  /api/v1/internal/users/by-username/{username}
"""
import asyncio
import logging
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # type: ignore

import httpx
from aiogram import Bot
from aiogram.exceptions import TelegramAPIError

from app.config import settings

logger = logging.getLogger(__name__)

POLL_INTERVAL = 60  # секунд


def _api_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.INTERNAL_API_URL,
        headers={"X-Bot-Secret": settings.BOT_SECRET},
        timeout=15.0,
    )


def _fmt_time(dt_str: str) -> str:
    """ISO-строку → локальное время в виде '14:30'."""
    try:
        tz = ZoneInfo(settings.APP_TIMEZONE)
    except Exception:
        tz = timezone.utc
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).strftime("%H:%M")


async def _send(bot: Bot, chat_id: int, text: str) -> None:
    try:
        await bot.send_message(chat_id, text)
    except TelegramAPIError as e:
        logger.warning("Telegram send error to %s: %s", chat_id, e)


async def run_reminder_task(bot: Bot) -> None:
    """Запускается как asyncio.Task в lifespan FastAPI."""
    logger.info("Reminder task started (interval=%ds)", POLL_INTERVAL)

    while True:
        await asyncio.sleep(POLL_INTERVAL)

        try:
            # 1. Получаем встречи для напоминания
            async with _api_client() as client:
                resp = await client.get("/api/v1/internal/bookings/reminders")
                resp.raise_for_status()
                bookings: list[dict] = resp.json()

            for b in bookings:
                organizer = b["user"]
                start_str = _fmt_time(b["start_time"])

                reminder_text = (
                    f"⏰ <b>Напоминание!</b> Через 15 минут:\n"
                    f"📌 <b>{b['title']}</b>\n"
                    f"🕐 {start_str}\n"
                    f"👤 {organizer['display_name']}"
                )
                if b.get("video_enabled"):
                    reminder_text += f"\n🎥 <a href=\"{settings.FRONTEND_URL}/meeting/{b['id']}\">Видеоконференция</a>"

                # 2. Уведомляем группу
                if settings.TG_GROUP_CHAT_ID:
                    await _send(bot, settings.TG_GROUP_CHAT_ID, reminder_text)

                # 3. Организатор лично
                if organizer.get("telegram_id"):
                    await _send(bot, organizer["telegram_id"], reminder_text)

                # 4. Гости лично
                if b.get("guests"):
                    for guest in b["guests"]:
                        tg_id = guest.get("telegram_id") if isinstance(guest, dict) else None
                        if tg_id and tg_id != organizer.get("telegram_id"):
                            guest_text = (
                                f"⏰ <b>Напоминание!</b> Через 15 минут:\n"
                                f"📌 <b>{b['title']}</b>\n"
                                f"🕐 {start_str}\n"
                                f"👤 Организатор: {organizer['display_name']}"
                            )
                            if b.get("video_enabled"):
                                guest_text += f"\n🎥 <a href=\"{settings.FRONTEND_URL}/meeting/{b['id']}\">Видеоконференция</a>"
                            await _send(bot, tg_id, guest_text)

                # 5. Помечаем через API (не напрямую в БД)
                async with _api_client() as client:
                    r = await client.post(f"/api/v1/internal/bookings/{b['id']}/mark-reminded")
                    if r.status_code != 200:
                        logger.warning("mark-reminded failed for booking %s: %s", b["id"], r.text)

        except asyncio.CancelledError:
            logger.info("Reminder task cancelled")
            return
        except Exception as e:
            logger.error("Reminder task error: %s", e, exc_info=True)
