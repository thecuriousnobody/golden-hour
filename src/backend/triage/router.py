"""AI triage engine endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class TriageRequest(BaseModel):
    transcript: str
    location: dict | None = None


class TriageResult(BaseModel):
    classification: str
    severity: str
    confidence: float
    symptoms_extracted: list[str]
    required_capability: str | None = None
    recommended_facilities: list[dict] = []


@router.post("/classify", response_model=TriageResult)
async def classify_emergency(request: TriageRequest):
    """Classify emergency type and severity from transcript."""
    # TODO: Integrate Claude API for medical reasoning
    return TriageResult(
        classification="unknown",
        severity="unknown",
        confidence=0.0,
        symptoms_extracted=[],
    )
