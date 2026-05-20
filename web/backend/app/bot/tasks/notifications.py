"""
Фоновая задача: каждые 60 секунд запрашивает у бэкенда новые и изменённые
встречи через /api/v1/internal/bookings/since и отправляет уведомления
в группу + личные сообщения гостям.

Никаких прямых обращений к БД — только HTTP к бэкенду.
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


def _fmt(dt_str: str) -> str:
    """ISO-строку → локальное время в виде '25.03 14:30'."""
    try:
        tz = ZoneInfo(settings.APP_TIMEZONE)
    except Exception:
        tz = timezone.utc
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).strftime("%d.%m %H:%M")


async def _send(bot: Bot, chat_id: int, text: str) -> None:
    try:
        await bot.send_message(chat_id, text)
    except TelegramAPIError as e:
        logger.warning("Telegram send error to %s: %s", chat_id, e)


async def run_notification_task(bot: Bot) -> None:
    """Запускается как asyncio.Task в lifespan FastAPI."""
    logger.info("Notification task started (interval=%ds)", POLL_INTERVAL)
    last_check = datetime.now(timezone.utc)

    while True:
        await asyncio.sleep(POLL_INTERVAL)
        now = datetime.now(timezone.utc)

        try:
            async with _api_client() as client:
                resp = await client.get(
                    "/api/v1/internal/bookings/since",
                    params={"updated_at": last_check.isoformat()},
                )
                resp.raise_for_status()
                bookings: list[dict] = resp.json()

            for b in bookings:
                organizer = b["user"]
                start_str = _fmt(b["start_time"])
                end_str   = _fmt(b["end_time"])
                is_new = b["created_at"] >= last_check.isoformat()

                # ── Текст для группы ──────────────────────────────────────
                if is_new:
                    group_text = (
                        f"📅 <b>Новое бронирование</b>\n"
                        f"👤 {organizer['display_name']}\n"
                        f"📌 {b['title']}\n"
                        f"🕐 {start_str} – {end_str}"
                    )
                    if b.get("description"):
                        group_text += f"\n📝 {b['description']}"
                else:
                    group_text = (
                        f"✏️ <b>Бронирование изменено</b>\n"
                        f"👤 {organizer['display_name']}\n"
                        f"📌 {b['title']}\n"
                        f"🕐 {start_str} – {end_str}"
                    )

                if b.get("video_enabled"):
                    video_line = f"\n🎥 <a href=\"{settings.FRONTEND_URL}/meeting/{b['id']}\">Видеоконференция</a>"
                    group_text += video_line

                if settings.TG_GROUP_CHAT_ID:
                    await _send(bot, settings.TG_GROUP_CHAT_ID, group_text)

                # ── Личные сообщения гостям (только при создании) ─────────
                if is_new and b.get("guests"):
                    guest_text = (
                        f"📅 Вас пригласили на встречу!\n"
                        f"📌 <b>{b['title']}</b>\n"
                        f"🕐 {start_str} – {end_str}\n"
                        f"👤 Организатор: {organizer['display_name']}"
                    )
                    if b.get("video_enabled"):
                        guest_text += f"\n🎥 <a href=\"{settings.FRONTEND_URL}/meeting/{b['id']}\">Видеоконференция</a>"
                    for guest in b["guests"]:
                        tg_id = guest.get("telegram_id") if isinstance(guest, dict) else None
                        if tg_id:
                            await _send(bot, tg_id, guest_text)

        except asyncio.CancelledError:
            logger.info("Notification task cancelled")
            return
        except Exception as e:
            logger.error("Notification task error: %s", e, exc_info=True)

        last_check = now
