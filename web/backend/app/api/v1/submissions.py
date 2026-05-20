from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import Role, User
from app.models.submission import Submission

router = APIRouter(prefix="/submissions", tags=["submissions"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class SubmissionCreate(BaseModel):
    text: str
    photo_b64: str | None = None  # data URL or raw base64; size enforced server-side


class SubmissionStatusUpdate(BaseModel):
    status: str  # "new" | "in_progress" | "closed"


class _UserBrief(BaseModel):
    id: int
    display_name: str
    username: str | None = None

    class Config:
        from_attributes = True


class SubmissionResponse(BaseModel):
    id: int
    user: _UserBrief
    text: str
    photo_b64: str | None
    status: str
    created_at: str

    class Config:
        from_attributes = True


# ── Constraints ───────────────────────────────────────────────────────────────

MAX_TEXT_CHARS = 4000
MAX_PHOTO_CHARS = 4_000_000  # ~3MB after base64 encoding


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", response_model=SubmissionResponse)
async def create_submission(
    body: SubmissionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubmissionResponse:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(400, f"text too long (max {MAX_TEXT_CHARS} chars)")

    photo = body.photo_b64
    if photo and len(photo) > MAX_PHOTO_CHARS:
        raise HTTPException(400, "photo too large (max ~3MB)")

    sub = Submission(
        user_id=current_user.id,
        text=text,
        photo_b64=photo or None,
        status="new",
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub, attribute_names=["user"])

    return SubmissionResponse(
        id=sub.id,
        user=_UserBrief(id=current_user.id, display_name=current_user.display_name, username=current_user.username),
        text=sub.text,
        photo_b64=sub.photo_b64,
        status=sub.status,
        created_at=sub.created_at.isoformat(),
    )


@router.get("/me", response_model=list[SubmissionResponse])
async def my_submissions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SubmissionResponse]:
    result = await db.execute(
        select(Submission)
        .options(selectinload(Submission.user))
        .where(Submission.user_id == current_user.id)
        .order_by(Submission.created_at.desc())
    )
    items = result.scalars().all()
    return [
        SubmissionResponse(
            id=s.id,
            user=_UserBrief(id=s.user.id, display_name=s.user.display_name, username=s.user.username),
            text=s.text,
            photo_b64=s.photo_b64,
            status=s.status,
            created_at=s.created_at.isoformat(),
        )
        for s in items
    ]


@router.get("/admin", response_model=list[SubmissionResponse])
async def admin_list_submissions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SubmissionResponse]:
    if current_user.role != Role.superadmin:
        raise HTTPException(403, "Superadmin only")
    result = await db.execute(
        select(Submission)
        .options(selectinload(Submission.user))
        .order_by(Submission.created_at.desc())
    )
    items = result.scalars().all()
    return [
        SubmissionResponse(
            id=s.id,
            user=_UserBrief(id=s.user.id, display_name=s.user.display_name, username=s.user.username),
            text=s.text,
            photo_b64=s.photo_b64,
            status=s.status,
            created_at=s.created_at.isoformat(),
        )
        for s in items
    ]


@router.patch("/admin/{submission_id}", response_model=SubmissionResponse)
async def admin_update_status(
    submission_id: int,
    body: SubmissionStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubmissionResponse:
    if current_user.role != Role.superadmin:
        raise HTTPException(403, "Superadmin only")
    if body.status not in {"new", "in_progress", "closed"}:
        raise HTTPException(400, "invalid status")
    result = await db.execute(
        select(Submission)
        .options(selectinload(Submission.user))
        .where(Submission.id == submission_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Submission not found")
    sub.status = body.status
    await db.commit()
    await db.refresh(sub, attribute_names=["user"])
    return SubmissionResponse(
        id=sub.id,
        user=_UserBrief(id=sub.user.id, display_name=sub.user.display_name, username=sub.user.username),
        text=sub.text,
        photo_b64=sub.photo_b64,
        status=sub.status,
        created_at=sub.created_at.isoformat(),
    )


@router.delete("/admin/{submission_id}", status_code=204)
async def admin_delete_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    if current_user.role != Role.superadmin:
        raise HTTPException(403, "Superadmin only")
    result = await db.execute(select(Submission).where(Submission.id == submission_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Submission not found")
    await db.delete(sub)
    await db.commit()
