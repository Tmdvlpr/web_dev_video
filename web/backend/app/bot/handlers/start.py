import logging

import httpx
from aiogram import Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from app.api.v1.internal import POSITIONS
from app.config import settings

router = Router()
logger = logging.getLogger(__name__)


def _client() -> httpx.AsyncClient:
    """HTTP-клиент для вызовов внутреннего API бэкенда."""
    return httpx.AsyncClient(
        base_url=settings.INTERNAL_API_URL,
        headers={"X-Bot-Secret": settings.BOT_SECRET},
        timeout=10.0,
    )


def _position_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=p, callback_data=f"position:{p}")] for p in POSITIONS]
    )


@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject) -> None:
    """
    /start           — приветствие, создать User через /internal/users/ensure
    /start {token}   — QR/deep-link авторизация через /internal/auth/consume-session
    """
    token = command.args

    if token:
        async with _client() as client:
            resp = await client.post(
                "/api/v1/internal/auth/consume-session",
                json={
                    "token": token,
                    "telegram_id": message.from_user.id,
                },
            )

        if resp.status_code == 200:
            await message.answer(
                "✅ Авторизация подтверждена!\n"
                "Вернитесь в браузер — страница обновится автоматически."
            )
        elif resp.status_code == 410:
            detail = resp.json().get("detail", "")
            if "expired" in detail.lower():
                await message.answer("❌ Ссылка устарела. Создайте новую в приложении.")
            else:
                await message.answer("❌ Ссылка уже использована.")
        else:
            await message.answer("❌ Ссылка недействительна.")
        return

    # /start без токена — создаём/обновляем пользователя
    async with _client() as client:
        resp = await client.post(
            "/api/v1/internal/users/ensure",
            json={
                "telegram_id": message.from_user.id,
                "first_name": message.from_user.first_name,
                "last_name": message.from_user.last_name,
                "username": message.from_user.username,
                "full_name": message.from_user.full_name,
            },
        )

    data = resp.json() if resp.status_code == 200 else {}
    has_position = data.get("has_position", True)

    if not has_position:
        await message.answer(
            "👋 Привет! Это <b>CorpMeet</b> — система бронирования переговорных.\n\n"
            "Выберите вашу должность, чтобы завершить регистрацию:",
            reply_markup=_position_keyboard(),
        )
    else:
        await message.answer(
            "👋 Привет! Это <b>CorpMeet</b> — система бронирования переговорных.\n\n"
            "Откройте мини-приложение чтобы посмотреть расписание и забронировать время."
        )


@router.callback_query(lambda c: c.data and c.data.startswith("position:"))
async def handle_position(callback: CallbackQuery) -> None:
    position = callback.data.split(":", 1)[1]
    async with _client() as client:
        await client.post(
            "/api/v1/internal/users/position",
            json={"telegram_id": callback.from_user.id, "position": position},
        )
    await callback.message.edit_text(
        f"✅ Должность сохранена: <b>{position}</b>\n\n"
        "Откройте мини-приложение чтобы посмотреть расписание и забронировать время."
    )
    await callback.answer()


@router.message(Command("chatid"))
async def cmd_chatid(message: Message) -> None:
    """/chatid — вернуть ID текущего чата (для настройки TG_GROUP_CHAT_ID в .env)."""
    await message.answer(
        f"💬 <b>Chat ID:</b> <code>{message.chat.id}</code>\n"
        f"👤 <b>User ID:</b> <code>{message.from_user.id}</code>"
    )


@router.message(Command("bind"))
async def cmd_bind(message: Message, command: CommandObject) -> None:
    """/bind <invite_code> — привязать эту TG-группу к пространству CorpMeet."""
    if message.chat.type not in ("group", "supergroup"):
        await message.answer("❌ Команда /bind работает только в групповых чатах.")
        return

    invite_code = (command.args or "").strip()
    if not invite_code:
        await message.answer("❌ Укажите invite-код пространства: /bind &lt;код&gt;")
        return

    async with _client() as client:
        resp = await client.post(
            "/api/v1/internal/workspaces/bind-telegram",
            json={
                "invite_code": invite_code,
                "chat_id": message.chat.id,
                "telegram_user_id": message.from_user.id,
            },
        )

    if resp.status_code == 200:
        name = resp.json().get("workspace_name", "")
        await message.answer(f"✅ Пространство <b>{name}</b> привязано к этой группе.\nТеперь сюда будут приходить уведомления о бронированиях.")
    elif resp.status_code == 404:
        await message.answer("❌ Пространство с таким кодом не найдено.")
    elif resp.status_code == 403:
        detail = resp.json().get("detail", "")
        if "not registered" in detail:
            await message.answer("❌ Ваш аккаунт не найден в CorpMeet. Сначала зарегистрируйтесь через /start.")
        else:
            await message.answer("❌ Только owner или admin пространства могут привязать группу.")
    else:
        await message.answer("❌ Ошибка при привязке. Попробуйте позже.")


@router.message(Command("unbind"))
async def cmd_unbind(message: Message) -> None:
    """/unbind — отвязать эту TG-группу от пространства CorpMeet."""
    if message.chat.type not in ("group", "supergroup"):
        await message.answer("❌ Команда /unbind работает только в групповых чатах.")
        return

    async with _client() as client:
        resp = await client.post(
            "/api/v1/internal/workspaces/unbind-telegram",
            json={
                "chat_id": message.chat.id,
                "telegram_user_id": message.from_user.id,
            },
        )

    if resp.status_code == 200:
        name = resp.json().get("workspace_name", "")
        await message.answer(f"✅ Пространство <b>{name}</b> отвязано от этой группы.")
    elif resp.status_code == 404:
        await message.answer("❌ Эта группа не привязана ни к одному пространству.")
    elif resp.status_code == 403:
        await message.answer("❌ Только owner или admin пространства могут отвязать группу.")
    else:
        await message.answer("❌ Ошибка при отвязке. Попробуйте позже.")
