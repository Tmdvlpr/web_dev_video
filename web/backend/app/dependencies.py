import json
from datetime import datetime, timezone
from typing import Optional

import pyseto
from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pyseto import Key
from pyseto.exceptions import DecryptError, PysetoError, VerifyError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User

# auto_error=False: return None instead of 403 when no Authorization header present
bearer_scheme = HTTPBearer(auto_error=False)

try:
    _PUBLIC_KEY = Key.new(
        version=4,
        purpose="public",
        key=settings.PASETO_PUBLIC_KEY_PEM.encode("utf-8"),
    )
except Exception as e:
    raise RuntimeError(
        f"PASETO_PUBLIC_KEY_PEM is missing or invalid — check .env. Underlying error: {e}"
    ) from e


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    cookie_token: Optional[str] = Cookie(default=None, alias="access_token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    # Bearer header takes precedence (Telegram Mini App); cookie is fallback (web browser)
    token = credentials.credentials if credentials else cookie_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        decoded = pyseto.decode(_PUBLIC_KEY, token)
        payload = json.loads(decoded.payload)
        user_id = int(payload["sub"])
        exp_str = payload["exp"]
        exp = datetime.fromisoformat(exp_str.replace("Z", "+00:00"))
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
        # Soft-validate iss/aud: only reject tokens that have wrong claims
        # (tokens without claims are accepted during the 7-day transition window)
        iss = payload.get("iss")
        aud = payload.get("aud")
        if iss and iss != "corpmeet-api":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token issuer")
        if aud and aud != "corpmeet-web":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token audience")
    except HTTPException:
        raise
    except (VerifyError, DecryptError, PysetoError, ValueError, KeyError, json.JSONDecodeError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    if not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account deactivated")
    return user
