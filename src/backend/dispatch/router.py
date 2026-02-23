"""Emergency dispatch orchestration endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.backend.triage.engine import run_triage, TriageAssessment
from src.backend.dispatch.orchestrator import run_dispatch, CallerInfo, DispatchResult
from src.backend.dispatch.whatsapp import get_message_log, clear_message_log
from src.backend.dispatch.session_store import session_store

router = APIRouter()


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class DispatchRequest(BaseModel):
    """Full dispatch request — can include raw transcript OR pre-computed triage."""
    # Option 1: Provide raw transcript (triage runs automatically)
    transcript: str | None = Field(default=None, description="English transcript to triage + dispatch")
    language: str = Field(default="en", description="Original language code")

    # Option 2: Provide pre-computed triage result
    triage_result: dict | None = Field(default=None, description="Pre-computed triage assessment")

    # Caller information
    caller_name: str = Field(default="Unknown Caller")
    caller_phone: str = Field(default="")
    latitude: float = Field(default=12.9716, description="Caller latitude (default: Bangalore center)")
    longitude: float = Field(default=77.5946, description="Caller longitude (default: Bangalore center)")
    family_contacts: list[dict] = Field(default_factory=list, description="[{name, phone}]")


class DispatchResponse(BaseModel):
    """Full dispatch response with all channel results."""
    session_id: str
    timestamp: str
    triage_summary: dict
    channels: list[dict]
    hospital_match: dict | None = None
    total_messages_sent: int
    all_messages: list[dict]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/initiate")
async def initiate_dispatch(request: DispatchRequest) -> DispatchResponse:
    """Run triage (if needed) and dispatch emergency response across all WhatsApp channels.

    This is the main entry point. You can either:
    1. Provide a transcript — triage runs automatically, then dispatch fires
    2. Provide a pre-computed triage_result — dispatch fires directly

    All 4 channels (hospital, ambulance, nurse, family) fire in parallel.
    """
    # Clear previous messages for this session
    clear_message_log()

    # Step 1: Get or compute triage assessment
    if request.triage_result:
        # Use pre-computed triage
        assessment = TriageAssessment(**request.triage_result)
    elif request.transcript:
        # Run triage on the transcript
        assessment = await run_triage(request.transcript, request.language)
    else:
        # No input — return error
        return DispatchResponse(
            session_id="error",
            timestamp="",
            triage_summary={"error": "Provide either transcript or triage_result"},
            channels=[],
            total_messages_sent=0,
            all_messages=[],
        )

    # Step 2: Build caller info
    caller = CallerInfo(
        phone=request.caller_phone,
        lat=request.latitude,
        lng=request.longitude,
        language=request.language,
        name=request.caller_name,
        family_contacts=request.family_contacts,
    )

    # Step 3: Run parallel dispatch
    result = await run_dispatch(assessment, caller)

    # Step 4: Return structured response
    return DispatchResponse(
        session_id=result.session_id,
        timestamp=result.timestamp,
        triage_summary=result.triage_summary,
        channels=[
            {
                "channel": c.channel,
                "status": c.status,
                "messages_sent": c.messages_sent,
                "details": c.details,
                "receipts": c.receipts,
            }
            for c in result.channels
        ],
        hospital_match=result.hospital_match,
        total_messages_sent=sum(c.messages_sent for c in result.channels),
        all_messages=result.all_messages,
    )


@router.get("/messages")
async def get_dispatch_messages():
    """Get all WhatsApp messages sent in the current session.

    Useful for the prototype UI to display message bubbles.
    """
    return {"messages": get_message_log()}


# ---------------------------------------------------------------------------
# Session state machine endpoints
# ---------------------------------------------------------------------------

class TransitionRequest(BaseModel):
    """Request to transition a session state."""
    trigger: str = Field(description="State machine trigger: start_triage, start_dispatch, ambulance_acknowledge, ambulance_depart, arrive_on_scene, begin_transport, arrive_at_hospital, resolve, escalate, cancel")
    metadata: dict = Field(default_factory=dict)


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """Get the current state and timeline of a dispatch session."""
    session = session_store.get(session_id)
    if not session:
        return {"error": "Session not found", "session_id": session_id}
    return session.to_dict()


@router.post("/session/{session_id}/transition")
async def transition_session(session_id: str, request: TransitionRequest):
    """Trigger a state transition on a dispatch session."""
    session = session_store.get(session_id)
    if not session:
        return {"error": "Session not found", "session_id": session_id}

    success = session.transition_to(request.trigger, request.metadata)
    return {
        "success": success,
        "session": session.to_dict(),
    }


@router.post("/session/{session_id}/cancel")
async def cancel_session(session_id: str):
    """Cancel an active dispatch session."""
    session = session_store.get(session_id)
    if not session:
        return {"error": "Session not found", "session_id": session_id}

    success = session.transition_to("cancel")
    return {
        "success": success,
        "session": session.to_dict(),
    }


@router.post("/session/{session_id}/acknowledge")
async def acknowledge_session(session_id: str, metadata: dict = {}):
    """Acknowledge ambulance dispatch (shorthand for ambulance_acknowledge trigger)."""
    session = session_store.get(session_id)
    if not session:
        return {"error": "Session not found", "session_id": session_id}

    success = session.transition_to("ambulance_acknowledge", metadata)
    return {
        "success": success,
        "session": session.to_dict(),
    }
