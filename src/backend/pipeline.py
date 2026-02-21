"""End-to-end emergency pipeline: Speech → Triage → Dispatch.

This is the unified endpoint that takes an emergency call from voice input
all the way through to WhatsApp dispatch. Each stage feeds into the next:

1. TRANSLATE: Kannada/Hindi/Tamil/Telugu → English (via Sarvam AI)
2. TRIAGE: English transcript → structured medical assessment (via Claude)
3. DISPATCH: Assessment → parallel WhatsApp alerts to hospital/ambulance/nurse/family

For the prototype, translation can be skipped by providing English text directly.
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.backend.triage.engine import run_triage
from src.backend.dispatch.orchestrator import run_dispatch, CallerInfo
from src.backend.dispatch.whatsapp import clear_message_log

logger = logging.getLogger("golden_hour.pipeline")

router = APIRouter()


class EmergencyRequest(BaseModel):
    """Input for the emergency pipeline."""
    # Text input (already translated to English, or English-original)
    transcript_english: str = Field(description="English transcript of the emergency call")
    transcript_original: str | None = Field(default=None, description="Original language transcript")
    language: str = Field(default="en", description="Original language code: kn, hi, ta, te, en")

    # Caller location
    latitude: float = Field(default=12.9716, description="Caller latitude")
    longitude: float = Field(default=77.5946, description="Caller longitude")

    # Caller identity
    caller_name: str = Field(default="Unknown Caller")
    caller_phone: str = Field(default="")
    family_contacts: list[dict] = Field(default_factory=list)


class PipelineStage(BaseModel):
    """Result from a single pipeline stage."""
    stage: str
    status: str
    duration_ms: float = 0
    data: dict


class EmergencyResponse(BaseModel):
    """Full response from the emergency pipeline."""
    session_id: str
    stages: list[PipelineStage]
    triage: dict
    dispatch: dict
    messages: list[dict]


@router.post("/emergency")
async def handle_emergency(request: EmergencyRequest) -> EmergencyResponse:
    """Full emergency pipeline: transcript → triage → dispatch.

    This is the single endpoint that drives the entire Golden Hour response.
    Call it with an English transcript and caller location, and it will:
    1. Run AI triage to extract symptoms and classify severity
    2. Match hospitals by capability and distance
    3. Dispatch ambulance, nurses, and family notifications via WhatsApp
    All in one call, with all dispatch channels firing in parallel.
    """
    import time
    clear_message_log()

    stages: list[PipelineStage] = []

    # --- Stage 1: Triage ---
    t0 = time.monotonic()
    assessment = await run_triage(
        transcript=request.transcript_english,
        language=request.language,
    )
    triage_ms = (time.monotonic() - t0) * 1000

    triage_data = {
        "condition": assessment.likely_condition,
        "severity": assessment.severity,
        "esi_level": assessment.esi_level,
        "triage_score": assessment.triage_score,
        "symptoms": [{"key": s.key, "value": s.value, "critical": s.critical} for s in assessment.symptoms],
        "required_capabilities": assessment.required_capabilities,
        "reasoning": assessment.reasoning,
        "time_criticality_minutes": assessment.time_criticality_minutes,
        "patient_demographics": assessment.patient_demographics,
    }

    stages.append(PipelineStage(
        stage="triage",
        status="complete",
        duration_ms=round(triage_ms, 1),
        data=triage_data,
    ))

    logger.info(
        "Triage complete: %s (%s, ESI-%d) in %.0fms",
        assessment.likely_condition, assessment.severity, assessment.esi_level, triage_ms,
    )

    # --- Stage 2: Dispatch ---
    t0 = time.monotonic()
    caller = CallerInfo(
        phone=request.caller_phone,
        lat=request.latitude,
        lng=request.longitude,
        language=request.language,
        name=request.caller_name,
        family_contacts=request.family_contacts,
    )

    dispatch_result = await run_dispatch(assessment, caller)
    dispatch_ms = (time.monotonic() - t0) * 1000

    dispatch_data = {
        "session_id": dispatch_result.session_id,
        "channels": [
            {
                "channel": c.channel,
                "status": c.status,
                "messages_sent": c.messages_sent,
                "details": c.details,
            }
            for c in dispatch_result.channels
        ],
        "hospital_match": dispatch_result.hospital_match,
        "total_messages": sum(c.messages_sent for c in dispatch_result.channels),
    }

    stages.append(PipelineStage(
        stage="dispatch",
        status="complete",
        duration_ms=round(dispatch_ms, 1),
        data=dispatch_data,
    ))

    logger.info(
        "Dispatch complete: %d channels, %d messages in %.0fms",
        len(dispatch_result.channels),
        sum(c.messages_sent for c in dispatch_result.channels),
        dispatch_ms,
    )

    return EmergencyResponse(
        session_id=dispatch_result.session_id,
        stages=stages,
        triage=triage_data,
        dispatch=dispatch_data,
        messages=dispatch_result.all_messages,
    )
