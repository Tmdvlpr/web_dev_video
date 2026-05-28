import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.limiter import limiter
from app.models.browser_session import BrowserSession
from app.models.user import User
from app.schemas.auth import BrowserSessionResponse, LoginRequest, RegisterRequest, TokenResponse, WebRegisterRequest
from app.schemas.user import UserResponse
from app.services.auth_service import (
    create_access_token,
    create_browser_session,
    login_user,
    register_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_EXPIRE_IN = settings.TOKEN_EXPIRE_DAYS * 86400


def _set_auth_cookie(response: Response, token: str) -> None:
    """Set httpOnly access_token cookie. Secure in production, Lax in dev."""
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=not settings.CORPMEET_DEV,
        samesite="lax" if settings.CORPMEET_DEV else "strict",
        max_age=_EXPIRE_IN,
        path="/",
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """Register a new Mini App user (first time only)."""
    if not body.first_name.strip() or not body.last_name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="first_name and last_name are required")

    token = await register_user(
        body.initData,
        body.first_name.strip(),
        body.last_name.strip(),
        db,
        position=body.position,
        invite_token=body.invite_token,
        ws_code=body.ws_code,
    )
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid initData or user already registered",
        )
    return TokenResponse(access_token=token, expires_in=_EXPIRE_IN)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("20/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """Login existing Mini App user via initData."""
    token = await login_user(body.initData, db)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not registered",
        )
    return TokenResponse(access_token=token, expires_in=_EXPIRE_IN)


@router.post("/browser/session", response_model=BrowserSessionResponse)
async def create_session(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BrowserSessionResponse:
    """Create a one-time browser session token for opening the web app from Mini App."""
    session_token = await create_browser_session(current_user.id, db)
    browser_url = f"{settings.FRONTEND_URL}/auth/session/{session_token}"
    return BrowserSessionResponse(session_token=session_token, browser_url=browser_url)


@router.post("/qr-session")
@limiter.limit("10/minute")
async def create_qr_session(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Create a QR session (no auth). Returns token + bot deep-link for scanning."""
    token = secrets.token_urlsafe(32)
    session = BrowserSession(
        token=token,
        user_id=None,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db.add(session)
    await db.commit()

    bot_url = f"https://t.me/{settings.TG_BOT_USERNAME}?start={token}" if settings.TG_BOT_USERNAME else None
    return {"token": token, "bot_url": bot_url, "expires_in": 600}


@router.get("/session/{session_token}")
@limiter.limit("60/minute")
async def consume_session(
    request: Request,
    session_token: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Check/consume a session token. Returns PASETO token + sets cookie if ready, 202 if pending."""
    from sqlalchemy import select

    result = await db.execute(
        select(BrowserSession).where(BrowserSession.token == session_token).with_for_update()
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Session expired")

    if not session.user_id:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=202, content={"status": "pending"})

    if session.used:
        raise HTTPException(status_code=410, detail="Session already consumed")
    session.used = True
    session.used_at = datetime.now(timezone.utc)
    await db.commit()

    token = create_access_token(session.user_id)
    _set_auth_cookie(response, token)
    return {"access_token": token, "expires_in": _EXPIRE_IN}


@router.post("/web-register")
@limiter.limit("5/minute")
async def web_register(
    request: Request,
    body: WebRegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Register directly from web (no Telegram required). Dev-only — gated by CORPMEET_DEV."""
    if not settings.CORPMEET_DEV:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Web registration disabled")
    from sqlalchemy import select

    first_name = body.first_name.strip()
    last_name = (body.last_name or "").strip()
    if not first_name:
        raise HTTPException(400, "first_name is required")

    display = f"{first_name} {last_name}".strip()
    user = User(
        telegram_id=None,
        name=display,
        first_name=first_name,
        last_name=last_name or None,
        is_registered=True,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id)
    _set_auth_cookie(response, token)
    return {"access_token": token, "expires_in": settings.TOKEN_EXPIRE_DAYS * 86400, "user_id": user.id}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return current_user


POSITIONS = [
    "Начальник департамента/отдела",
    "PM",
    "Аналитик",
    "Программист и др.",
    "Дизайнер",
]


class UpdateMeRequest(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    position: str | None = Field(None, max_length=100)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UpdateMeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Update own profile fields (first_name, last_name, position)."""
    first = body.first_name.strip()
    last = (body.last_name or "").strip()
    current_user.first_name = first
    current_user.last_name = last or None
    current_user.name = f"{first} {last}".strip()
    if body.position is not None:
        pos = body.position.strip()
        if pos and pos not in POSITIONS:
            raise HTTPException(status_code=400, detail="Invalid position")
        current_user.position = pos or None
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/logout")
async def logout(response: Response) -> dict:
    """Clear the httpOnly auth cookie."""
    response.delete_cookie(key="access_token", path="/")
    return {"ok": True}


if settings.CORPMEET_DEV:
    @router.post("/dev-login", response_model=TokenResponse)
    @limiter.limit("20/minute")
    async def dev_login(
        request: Request,
        response: Response,
        db: AsyncSession = Depends(get_db),
        dev_id: int = Query(default=1, ge=1, le=9),
    ) -> TokenResponse:
        """Dev-only: instant login as a test user (no Telegram required).
        Use ?dev_id=1..9 to log in as different test users simultaneously."""
        from sqlalchemy import select as _select
        DEV_TG_ID = 999_000_000 + dev_id
        names = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Hank", "Iris"]
        name = names[dev_id - 1]
        result = await db.execute(_select(User).where(User.telegram_id == DEV_TG_ID))
        user = result.scalar_one_or_none()
        if not user:
            user = User(
                telegram_id=DEV_TG_ID,
                first_name=name,
                last_name=f"Dev{dev_id}",
                name=f"{name} Dev{dev_id}",
                username=f"devuser{dev_id}",
                role="admin",
                is_registered=True,
                is_active=True,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
        token = create_access_token(user.id)
        _set_auth_cookie(response, token)
        return TokenResponse(access_token=token, expires_in=_EXPIRE_IN)

    @router.get("/dev-login")
    @limiter.limit("20/minute")
    async def dev_login_get(
        request: Request,
        db: AsyncSession = Depends(get_db),
        dev_id: int = Query(default=1, ge=1, le=9),
    ):
        """Dev-only: open in browser → stores token in localStorage → redirects to app."""
        from fastapi.responses import HTMLResponse
        tmp_response = Response()
        token_data = await dev_login(request=request, response=tmp_response, db=db, dev_id=dev_id)
        token = token_data.access_token
        cookie_header = tmp_response.headers.get("set-cookie", "")
        html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dev Login</title></head>
<body><script>
localStorage.setItem('access_token', '{token}');
window.location.replace('/');
</script><p>Входим как Dev{dev_id}…</p></body></html>"""
        resp = HTMLResponse(content=html)
        if cookie_header:
            resp.headers.append("set-cookie", cookie_header)
        return resp
