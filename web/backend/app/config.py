from pathlib import Path
from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    DATABASE_URL: str
    TELEGRAM_BOT_TOKEN: str
    PASETO_PRIVATE_KEY_PEM: str
    PASETO_PUBLIC_KEY_PEM: str
    TOKEN_EXPIRE_DAYS: int = 7
    FRONTEND_URL: str = "http://localhost:5173"
    APP_TIMEZONE: str = "Europe/Moscow"
    # TG Bot: группа/чат для уведомлений о встречах и напоминаний
    TG_GROUP_CHAT_ID: int = 0
    # Секрет для внутреннего API (bot → backend). Задать в .env
    BOT_SECRET: str = ""
    # Адрес бэкенда для вызовов из бота (внутри одного процесса)
    INTERNAL_API_URL: str = "http://127.0.0.1:8000"
    # Username бота (без @) для QR-авторизации
    TG_BOT_USERNAME: str = "corpmeetbot"
    # PostgreSQL schema (dev / public / etc.)
    DB_SCHEMA: str = "public"
    # Включить dev-login (только для локальной разработки)
    CORPMEET_DEV: bool = False

    # === Video service (LiveKit) ===
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""
    LIVEKIT_HOST: str = "ws://livekit:7880"
    LIVEKIT_PUBLIC_URL: str = "ws://localhost:7880"
    VIDEO_ENABLED: bool = True
    VIDEO_MAX_PARTICIPANTS: int = 50
    VIDEO_RECORDING_ENABLED: bool = True
    CHAT_FILES_PATH: str = "/app/data/chat-files"
    CHAT_FILES_MAX_SIZE: int = 50 * 1024 * 1024  # 50 MB
    RECORDINGS_PATH: str = "/app/data/recordings"

    class Config:
        env_file = str(_ENV_FILE)


settings = Settings()
