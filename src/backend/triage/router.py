"""AI triage engine endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.backend.triage.engine import run_triage, TriageAssessment

router = APIRouter()


class TriageRequest(BaseModel):
    transcript: str = Field(description="English transcript of the emergency call")
    language: str = Field(default="en", description="Original language code (kn, hi, ta, te, en)")
    location: dict | None = Field(default=None, description="Caller location {lat, lng}")


class TriageResponse(BaseModel):
    """Full triage response including assessment and location."""
    assessment: TriageAssessment
    location: dict | None = None


@router.post("/classify")
async def classify_emergency(request: TriageRequest) -> TriageResponse:
    """Classify emergency type and severity from transcript.

    Uses Claude API for intelligent medical triage with keyword fallback.
    Returns structured assessment with ESI level, required capabilities, etc.
    """
    assessment = await run_triage(
        transcript=request.transcript,
        language=request.language,
    )

    return TriageResponse(
        assessment=assessment,
        location=request.location,
    )
