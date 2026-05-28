from pydantic import BaseModel


class RegisterRequest(BaseModel):
    initData: str
    first_name: str
    last_name: str
    position: str | None = None
    invite_token: str | None = None
    ws_code: str | None = None


class LoginRequest(BaseModel):
    initData: str


class TokenResponse(BaseModel):
    access_token: str
    expires_in: int
    token_type: str = "bearer"


class BrowserSessionResponse(BaseModel):
    session_token: str
    browser_url: str


class WebRegisterRequest(BaseModel):
    first_name: str
    last_name: str | None = None
