import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

import pyseto
from pyseto import Key
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.browser_session import BrowserSession
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceMemberRole, WorkspaceMemberStatus

# initData freshness window (5 minutes for Mini App)
INIT_DATA_MAX_AGE_SECONDS = 300


def verify_telegram_init_data(init_data: str) -> dict | None:
    """Verify HMAC signature of Telegram Mini App initData.

    Uses 'WebAppData' as the HMAC key — different from Login Widget which uses sha256(bot_token).
    Returns parsed user dict on success, None on failure.
    """
    try:
        params: dict[str, str] = {}
        for pair in init_data.split("&"):
            if "=" not in pair:
                continue
            k, v = pair.split("=", 1)
            params[k] = unquote(v)

        received_hash = params.pop("hash", None)
        if not received_hash:
            return None

        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))

        secret_key = hmac.new(
            b"WebAppData",
            settings.TELEGRAM_BOT_TOKEN.encode(),
            hashlib.sha256,
        ).digest()

        computed_hash = hmac.new(
            secret_key,
            data_check_string.encode(),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(computed_hash, received_hash):
            return None

        auth_date = int(params.get("auth_date", 0))
        if datetime.now(timezone.utc).timestamp() - auth_date > INIT_DATA_MAX_AGE_SECONDS:
            return None

        user_json = params.get("user", "{}")
        return json.loads(user_json)
    except Exception:
        return None


try:
    _PRIVATE_KEY = Key.new(
        version=4,
        purpose="public",
        key=settings.PASETO_PRIVATE_KEY_PEM.encode("utf-8"),
    )
except Exception as e:
    raise RuntimeError(
        f"PASETO_PRIVATE_KEY_PEM is missing or invalid — check .env. Underlying error: {e}"
    ) from e


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.TOKEN_EXPIRE_DAYS)
    payload = json.dumps({
        "sub": str(user_id),
        "exp": expire.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "iss": "corpmeet-api",
        "aud": "corpmeet-web",
    }).encode("utf-8")
    token = pyseto.encode(_PRIVATE_KEY, payload)
    return token.decode("utf-8")


async def register_user(
    init_data: str,
    first_name: str,
    last_name: str,
    db: AsyncSession,
    position: str | None = None,
    invite_token: str | None = None,
    ws_code: str | None = None,
) -> str | None:
    """Register a new Mini App user. Returns JWT or None if already registered / invalid."""
    user_data = verify_telegram_init_data(init_data)
    if not user_data:
        return None

    telegram_id = user_data.get("id")
    if not telegram_id:
        return None

    result = await db.execute(select(User).where(User.telegram_id == telegram_id))
    existing = result.scalar_one_or_none()
    if existing:
        if existing.is_registered:
            return None  # Already fully registered — use /login instead
        # Pre-created by bot (is_registered=False) — complete the profile
        existing.first_name = first_name
        existing.last_name = last_name
        existing.name = f"{first_name} {last_name}".strip()
        if position:
            existing.position = position
        existing.is_registered = True
        if invite_token:
            member_res = await db.execute(
                select(WorkspaceMember).where(WorkspaceMember.invite_token == invite_token)
            )
            member = member_res.scalar_one_or_none()
            if member and member.status == WorkspaceMemberStatus.pending:
                member.user_id = existing.id
                member.pending_username = None
                member.status = WorkspaceMemberStatus.active
                member.invite_token = None
        elif ws_code:
            ws_res = await db.execute(
                select(Workspace).where(
                    Workspace.invite_code == ws_code,
                    Workspace.archived_at.is_(None),
                )
            )
            workspace = ws_res.scalar_one_or_none()
            if workspace:
                already = await db.execute(
                    select(WorkspaceMember).where(
                        WorkspaceMember.workspace_id == workspace.id,
                        WorkspaceMember.user_id == existing.id,
                    )
                )
                if not already.scalar_one_or_none():
                    db.add(WorkspaceMember(
                        workspace_id=workspace.id,
                        user_id=existing.id,
                        role=WorkspaceMemberRole.member,
                        status=WorkspaceMemberStatus.active,
                    ))
        await db.commit()
        await db.refresh(existing)
        return create_access_token(existing.id)

    display_name = f"{first_name} {last_name}".strip()
    user = User(
        telegram_id=telegram_id,
        first_name=first_name,
        last_name=last_name,
        name=display_name,
        username=user_data.get("username"),
        language_code=user_data.get("language_code"),
        is_registered=True,
        is_active=True,
    )
    if position:
        user.position = position
    db.add(user)
    await db.flush()

    if invite_token:
        member_res = await db.execute(
            select(WorkspaceMember).where(WorkspaceMember.invite_token == invite_token)
        )
        member = member_res.scalar_one_or_none()
        if member and member.status == WorkspaceMemberStatus.pending:
            member.user_id = user.id
            member.pending_username = None
            member.status = WorkspaceMemberStatus.active
            member.invite_token = None
    elif ws_code:
        ws_res = await db.execute(
            select(Workspace).where(
                Workspace.invite_code == ws_code,
                Workspace.archived_at.is_(None),
            )
        )
        workspace = ws_res.scalar_one_or_none()
        if workspace:
            new_member = WorkspaceMember(
                workspace_id=workspace.id,
                user_id=user.id,
                role=WorkspaceMemberRole.member,
                status=WorkspaceMemberStatus.active,
            )
            db.add(new_member)

    await db.commit()
    await db.refresh(user)

    return create_access_token(user.id)


async def login_user(init_data: str, db: AsyncSession) -> str | None:
    """Login existing user via Mini App initData. Returns JWT or None if not found / invalid."""
    user_data = verify_telegram_init_data(init_data)
    if not user_data:
        return None

    telegram_id = user_data.get("id")
    if not telegram_id:
        return None

    result = await db.execute(select(User).where(User.telegram_id == telegram_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_registered:
        return None

    # Update username and language_code if changed
    new_username = user_data.get("username")
    new_lang = user_data.get("language_code")
    dirty = False
    if new_username and new_username != user.username:
        user.username = new_username
        dirty = True
    if new_lang and new_lang != user.language_code:
        user.language_code = new_lang
        dirty = True
    if dirty:
        await db.commit()

    return create_access_token(user.id)


async def create_browser_session(user_id: int, db: AsyncSession) -> str:
    """Create a one-time browser session token (5 min TTL)."""
    token = secrets.token_urlsafe(32)
    session = BrowserSession(
        token=token,
        user_id=user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    db.add(session)
    await db.commit()
    return token


async def consume_browser_session(session_token: str, db: AsyncSession) -> str | None:
    """Exchange a one-time session token for a JWT. Burns the token on use."""
    result = await db.execute(
        select(BrowserSession).where(BrowserSession.token == session_token).with_for_update()
    )
    session = result.scalar_one_or_none()

    if not session:
        return None
    if session.used:
        return None

    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return None

    session.used = True
    session.used_at = datetime.now(timezone.utc)
    await db.commit()

    return create_access_token(session.user_id)
