"""
LiveKit video service — room management, token generation, egress recording, webhook verification.

NOTE: Verify method signatures against the installed livekit-api version.
      The AccessToken/VideoGrants API may differ slightly between minor versions.
"""
import hashlib
import hmac as _hmac
import secrets
import uuid
from datetime import timedelta
from pathlib import Path

from app.config import settings


def generate_room_name(booking_id: int) -> str:
    """Generate a unique LiveKit room name for a booking."""
    return f"corpmeet-{booking_id}-{secrets.token_urlsafe(8)}"


def derive_e2ee_key(room_name: str) -> str:
    """Derive a deterministic E2EE key from room_name using HMAC-SHA256.

    All participants call this with the same room_name and get the same key,
    so no extra key-exchange infrastructure is needed.
    """
    secret = settings.PASETO_PRIVATE_KEY_PEM[:32].encode("utf-8")
    return _hmac.new(secret, room_name.encode("utf-8"), hashlib.sha256).hexdigest()


def _lk_http_url() -> str:
    return (
        settings.LIVEKIT_HOST
        .replace("ws://", "http://")
        .replace("wss://", "https://")
    )


def create_access_token(
    *,
    room_name: str,
    user_id: int,
    user_name: str,
    can_publish: bool = True,
    identity: str | None = None,
) -> str:
    """Issue a LiveKit JWT access token for a user to join a room.

    Pass `identity` explicitly for external guests who have no user_id.
    """
    from livekit.api import AccessToken, VideoGrants

    grants = VideoGrants(
        room=room_name,
        room_join=True,
        can_publish=can_publish,
        can_subscribe=True,
        can_publish_data=True,
    )
    token = (
        AccessToken(api_key=settings.LIVEKIT_API_KEY, api_secret=settings.LIVEKIT_API_SECRET)
        .with_identity(identity if identity is not None else f"user-{user_id}")
        .with_name(user_name)
        .with_grants(grants)
        .with_ttl(timedelta(hours=4))
    )
    return token.to_jwt()


async def ensure_room_exists(room_name: str) -> None:
    """Create a LiveKit room (idempotent — safe to call if room already exists)."""
    from livekit.api import LiveKitAPI
    from livekit.protocol.room import CreateRoomRequest

    async with LiveKitAPI(
        url=_lk_http_url(),
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    ) as lkapi:
        await lkapi.room.create_room(
            CreateRoomRequest(
                name=room_name,
                empty_timeout=300,
                max_participants=settings.VIDEO_MAX_PARTICIPANTS,
            )
        )


async def kick_participant(room_name: str, identity: str) -> None:
    """Remove a participant from the room (no-op if room/participant doesn't exist)."""
    from livekit.api import LiveKitAPI
    from livekit.protocol.room import RemoveParticipantRequest

    try:
        async with LiveKitAPI(
            url=_lk_http_url(),
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
        ) as lkapi:
            await lkapi.room.remove_participant(
                RemoveParticipantRequest(room=room_name, identity=identity)
            )
    except Exception:
        pass


async def is_participant_in_room(room_name: str, identity: str) -> bool:
    """Return True if a participant with the given identity is currently in the room."""
    from livekit.api import LiveKitAPI
    from livekit.protocol.room import ListParticipantsRequest

    try:
        async with LiveKitAPI(
            url=_lk_http_url(),
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
        ) as lkapi:
            resp = await lkapi.room.list_participants(
                ListParticipantsRequest(room=room_name)
            )
            return any(p.identity == identity for p in resp.participants)
    except Exception:
        return False


async def start_recording(room_name: str) -> str:
    """Start composite room recording via livekit-egress (VP9/WebM). Returns egress_id."""
    from livekit.api import LiveKitAPI
    from livekit.protocol.egress import (
        EncodedFileOutput,
        EncodedFileType,
        RoomCompositeEgressRequest,
    )

    # VP9 encoding options — import path varies by livekit-protocol version
    encoding_options = None
    try:
        from livekit.protocol.egress import EncodingOptions
        from livekit.protocol.models import VideoCodec
        encoding_options = EncodingOptions(video_codec=VideoCodec.VP9)
    except (ImportError, AttributeError):
        pass  # Fall back to default codec if VP9 not available

    file_output = EncodedFileOutput(
        file_type=EncodedFileType.WEBM,
        filepath=f"/out/{room_name}.webm",
    )
    if encoding_options is not None:
        file_output = EncodedFileOutput(
            file_type=EncodedFileType.WEBM,
            filepath=f"/out/{room_name}.webm",
            options=encoding_options,
        )

    async with LiveKitAPI(
        url=_lk_http_url(),
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    ) as lkapi:
        resp = await lkapi.egress.start_room_composite_egress(
            RoomCompositeEgressRequest(
                room_name=room_name,
                file_outputs=[file_output],
            )
        )
    return resp.egress_id


async def stop_recording(egress_id: str) -> None:
    """Stop an active egress recording (safe to call even if already stopped)."""
    from livekit.api import LiveKitAPI
    from livekit.protocol.egress import StopEgressRequest

    async with LiveKitAPI(
        url=_lk_http_url(),
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    ) as lkapi:
        try:
            await lkapi.egress.stop_egress(StopEgressRequest(egress_id=egress_id))
        except Exception:
            pass  # Egress may have already finished


def verify_webhook(body: bytes, auth_header: str) -> object:
    """Verify LiveKit webhook signature and return the WebhookEvent proto object."""
    from livekit.api import TokenVerifier, WebhookReceiver

    token_verifier = TokenVerifier(
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    )
    webhook_receiver = WebhookReceiver(token_verifier=token_verifier)
    return webhook_receiver.receive(body=body.decode("utf-8"), auth_token=auth_header)


def get_chat_file_path(booking_id: int, original_filename: str) -> Path:
    """Return a unique file path under CHAT_FILES_PATH for a given booking."""
    ext = Path(original_filename).suffix
    safe_name = f"{uuid.uuid4().hex}{ext}"
    directory = Path(settings.CHAT_FILES_PATH) / str(booking_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory / safe_name
