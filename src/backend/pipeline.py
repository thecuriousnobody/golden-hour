"""End-to-end emergency pipeline: Speech → Triage → Dispatch → Track.

This is the unified endpoint that takes an emergency call from voice input
all the way through to WhatsApp dispatch. Each stage feeds into the next:

1. TRANSLATE: Kannada/Hindi/Tamil/Telugu → English (via Sarvam AI)
2. TRIAGE: English transcript → structured medical assessment (via Claude)
3. DISPATCH: Assessment → parallel WhatsApp alerts to hospital/ambulance/nurse/family
4. TRACK: State machine session + real-time timeline + location expiry

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
    timeline: list[dict] = []
    tracking_url: str = ""


@router.post("/emergency")
async def handle_emergency(request: EmergencyRequest) -> EmergencyResponse:
    """Full emergency pipeline: transcript → triage → dispatch → track.

    This is the single endpoint that drives the entire Golden Hour response.
    Call it with an English transcript and caller location, and it will:
    1. Run AI triage to extract symptoms and classify severity
    2. Match hospitals by capability and distance
    3. Dispatch ambulance, nurses, and family notifications via WhatsApp
    4. Create a state machine session with real-time timeline
    5. Set location expiry and schedule escalation timers
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
        "differential_diagnoses": assessment.differential_diagnoses,
        "recommended_first_aid": assessment.recommended_first_aid,
        "confidence": assessment.confidence,
        "triage_source": assessment.triage_source,
    }

    stages.append(PipelineStage(
        stage="triage",
        status="complete",
        duration_ms=round(triage_ms, 1),
        data=triage_data,
    ))

    logger.info(
        "Triage complete: %s (%s, ESI-%d) via %s in %.0fms",
        assessment.likely_condition, assessment.severity, assessment.esi_level,
        assessment.triage_source, triage_ms,
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

    # --- Stage 3: Post-dispatch (location expiry, escalation timer) ---
    tracking_url = f"https://goldenhour.app/track/{dispatch_result.session_id}"

    # Set location auto-expiry (best-effort, non-blocking)
    try:
        from src.backend.realtime.pubsub import set_location_expiry
        await set_location_expiry(dispatch_result.session_id)
    except Exception:
        pass

    # Schedule escalation timer (best-effort, non-blocking)
    try:
        from src.backend.tasks.celery_app import schedule_task
        schedule_task(
            "src.backend.tasks.escalation.escalation_timer",
            kwargs={"session_id": dispatch_result.session_id, "tier": 0},
            countdown=120,  # 2 minutes
        )
    except Exception:
        pass

    # Broadcast state to WebSocket clients (best-effort)
    try:
        from src.backend.realtime.websocket import manager
        await manager.broadcast_state_change(
            dispatch_result.session_id,
            "dispatching",
            dispatch_result.timeline,
        )
    except Exception:
        pass

    return EmergencyResponse(
        session_id=dispatch_result.session_id,
        stages=stages,
        triage=triage_data,
        dispatch=dispatch_data,
        messages=dispatch_result.all_messages,
        timeline=dispatch_result.timeline,
        tracking_url=tracking_url,
    )
