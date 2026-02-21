"""Parallel Dispatch Orchestrator — the WhatsApp-first emergency coordination engine.

After triage produces a structured assessment, this orchestrator fires off
ALL dispatch channels simultaneously via WhatsApp:

1. HOSPITAL — Notify the best-matching hospital with patient packet
2. AMBULANCE — Dispatch nearest available ambulance with pickup + destination
3. NURSES — Alert off-duty nurses/first responders within radius
4. FAMILY — Notify emergency contacts with location and status

Design principle: Do NOT wait for one channel before starting another.
India's emergency infrastructure has gaps — parallel activation saves lives.
"""

import asyncio
import json
import uuid
import logging
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path

from src.backend.triage.engine import TriageAssessment
from src.backend.dispatch.hospital_matcher import (
    match_hospitals,
    get_best_hospital,
    HospitalMatch,
    haversine_km,
    load_hospitals,
)
from src.backend.dispatch.whatsapp import (
    WhatsAppMessage,
    WhatsAppDeliveryReceipt,
    send_whatsapp_message,
    get_message_log,
)

logger = logging.getLogger("golden_hour.dispatch")

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class CallerInfo:
    """Information about the emergency caller."""
    phone: str = ""
    lat: float = 0.0
    lng: float = 0.0
    language: str = "en"
    name: str = "Unknown Caller"
    family_contacts: list[dict] = field(default_factory=list)  # [{name, phone}]


@dataclass
class ChannelResult:
    """Result from a single dispatch channel."""
    channel: str  # hospital, ambulance, nurse, family
    status: str   # dispatched, no_match, failed
    messages_sent: int = 0
    details: dict = field(default_factory=dict)
    receipts: list[dict] = field(default_factory=list)


@dataclass
class DispatchResult:
    """Complete result from the parallel dispatch."""
    session_id: str
    timestamp: str
    triage_summary: dict
    channels: list[ChannelResult]
    hospital_match: dict | None = None
    all_messages: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Responder loading (nurses + ambulances from seed data)
# ---------------------------------------------------------------------------

_nurses: list[dict] = []
_ambulances: list[dict] = []


def _load_responders():
    """Load nurse and ambulance seed data."""
    global _nurses, _ambulances

    base = Path(__file__).parent.parent.parent.parent / "data" / "responders"

    nurses_path = base / "bangalore_nurses.json"
    if nurses_path.exists():
        with open(nurses_path) as f:
            _nurses = json.load(f)
        logger.info("Loaded %d nurses", len(_nurses))

    ambulances_path = base / "bangalore_ambulances.json"
    if ambulances_path.exists():
        with open(ambulances_path) as f:
            _ambulances = json.load(f)
        logger.info("Loaded %d ambulances", len(_ambulances))


def _get_nurses() -> list[dict]:
    if not _nurses:
        _load_responders()
    return _nurses


def _get_ambulances() -> list[dict]:
    if not _ambulances:
        _load_responders()
    return _ambulances


# ---------------------------------------------------------------------------
# Channel 1: Hospital notification
# ---------------------------------------------------------------------------

async def _dispatch_hospital(
    assessment: TriageAssessment,
    caller: CallerInfo,
) -> ChannelResult:
    """Notify the best-matching hospital with a structured patient packet."""
    match = get_best_hospital(
        required_capabilities=assessment.required_capabilities,
        caller_lat=caller.lat,
        caller_lng=caller.lng,
    )

    if not match:
        return ChannelResult(
            channel="hospital",
            status="no_match",
            details={"reason": "No hospitals found within range"},
        )

    h = match.hospital

    # Build the hospital notification message
    symptoms_text = ", ".join(s.value for s in assessment.symptoms if s.critical)
    body = (
        f"🚨 INCOMING EMERGENCY\n\n"
        f"Condition: {assessment.likely_condition}\n"
        f"Severity: {assessment.severity} (ESI-{assessment.esi_level})\n"
        f"Critical symptoms: {symptoms_text}\n"
        f"Required: {', '.join(assessment.required_capabilities)}\n"
        f"Patient: {assessment.patient_demographics}\n"
        f"ETA: ~{int(match.distance_km * 3)}min by ambulance\n"  # Rough 20km/h in Bangalore traffic
        f"Time window: {assessment.time_criticality_minutes}min\n\n"
        f"Capability match: {int(match.capability_score * 100)}%\n"
        f"Distance: {match.distance_km}km\n\n"
        f"AI-assisted triage — not a medical diagnosis."
    )

    receipt = await send_whatsapp_message(WhatsAppMessage(
        to=h.whatsapp_number,
        body=body,
        channel="hospital",
        interactive_buttons=["ACKNOWLEDGE", "DIVERT"],
    ))

    return ChannelResult(
        channel="hospital",
        status="dispatched",
        messages_sent=1,
        details={
            "hospital_id": h.id,
            "hospital_name": h.name,
            "distance_km": match.distance_km,
            "capability_score": match.capability_score,
            "matched_capabilities": match.matched_capabilities,
            "missing_capabilities": match.missing_capabilities,
            "eta_minutes": int(match.distance_km * 3),
        },
        receipts=[{
            "message_id": receipt.message_id,
            "to": receipt.to,
            "status": receipt.status,
        }],
    )


# ---------------------------------------------------------------------------
# Channel 2: Ambulance dispatch
# ---------------------------------------------------------------------------

async def _dispatch_ambulance(
    assessment: TriageAssessment,
    caller: CallerInfo,
    hospital_match: HospitalMatch | None,
) -> ChannelResult:
    """Dispatch the nearest available ambulance with pickup and destination."""
    ambulances = _get_ambulances()
    available = [a for a in ambulances if a.get("available", False)]

    if not available:
        return ChannelResult(
            channel="ambulance",
            status="no_match",
            details={"reason": "No ambulances available"},
        )

    # Find nearest available ambulance
    def distance_to_caller(amb):
        loc = amb.get("location", {})
        return haversine_km(caller.lat, caller.lng, loc.get("lat", 0), loc.get("lng", 0))

    available.sort(key=distance_to_caller)
    nearest = available[0]
    dist = distance_to_caller(nearest)

    # Prefer ALS ambulance for critical cases
    if assessment.esi_level <= 2:
        als_available = [a for a in available if a.get("type") == "als"]
        if als_available:
            als_available.sort(key=distance_to_caller)
            nearest = als_available[0]
            dist = distance_to_caller(nearest)

    # Build ambulance dispatch message
    dest_text = ""
    if hospital_match:
        dest_text = f"\nDestination: {hospital_match.hospital.name} ({hospital_match.distance_km}km from patient)"

    body = (
        f"🚑 EMERGENCY DISPATCH\n\n"
        f"Pickup: https://maps.google.com/?q={caller.lat},{caller.lng}\n"
        f"Patient: {assessment.likely_condition} ({assessment.severity})\n"
        f"ESI Level: {assessment.esi_level}\n"
        f"Time window: {assessment.time_criticality_minutes}min"
        f"{dest_text}\n\n"
        f"Critical symptoms: {', '.join(s.value for s in assessment.symptoms if s.critical)}\n"
        f"Your distance: {dist:.1f}km"
    )

    receipt = await send_whatsapp_message(WhatsAppMessage(
        to=nearest.get("whatsapp_number", ""),
        body=body,
        channel="ambulance",
        location={"lat": caller.lat, "lng": caller.lng, "label": "Patient Location"},
        interactive_buttons=["ACCEPT", "DECLINE"],
    ))

    return ChannelResult(
        channel="ambulance",
        status="dispatched",
        messages_sent=1,
        details={
            "ambulance_id": nearest["id"],
            "ambulance_name": nearest["name"],
            "ambulance_type": nearest.get("type", "unknown"),
            "provider": nearest.get("provider", ""),
            "distance_km": round(dist, 2),
            "equipment": nearest.get("equipment", []),
        },
        receipts=[{
            "message_id": receipt.message_id,
            "to": receipt.to,
            "status": receipt.status,
        }],
    )


# ---------------------------------------------------------------------------
# Channel 3: Off-duty nurse / first responder pager
# ---------------------------------------------------------------------------

async def _dispatch_nurses(
    assessment: TriageAssessment,
    caller: CallerInfo,
    radius_km: float = 5.0,
) -> ChannelResult:
    """Alert off-duty nurses within radius who can provide immediate assistance."""
    nurses = _get_nurses()

    # Filter: available + within radius
    nearby = []
    for n in nurses:
        if not n.get("available", False):
            continue
        loc = n.get("location", {})
        dist = haversine_km(caller.lat, caller.lng, loc.get("lat", 0), loc.get("lng", 0))
        nurse_radius = n.get("radius_km", 5)
        if dist <= min(radius_km, nurse_radius):
            nearby.append((n, dist))

    if not nearby:
        # Expand radius and try again
        for n in nurses:
            if not n.get("available", False):
                continue
            loc = n.get("location", {})
            dist = haversine_km(caller.lat, caller.lng, loc.get("lat", 0), loc.get("lng", 0))
            if dist <= radius_km * 2:
                nearby.append((n, dist))

    if not nearby:
        return ChannelResult(
            channel="nurse",
            status="no_match",
            details={"reason": f"No available nurses within {radius_km * 2}km"},
        )

    # Sort by distance
    nearby.sort(key=lambda x: x[1])

    # Send alerts to all nearby nurses simultaneously
    receipts = []
    tasks = []

    for nurse, dist in nearby:
        body = (
            f"⚕️ EMERGENCY ALERT — {dist:.1f}km from you\n\n"
            f"Condition: {assessment.likely_condition} ({assessment.severity})\n"
            f"Location: https://maps.google.com/?q={caller.lat},{caller.lng}\n"
            f"Patient: {assessment.patient_demographics}\n"
            f"Needs: {', '.join(assessment.required_capabilities[:3])}\n\n"
            f"Can you assist? Ambulance is also dispatched."
        )

        tasks.append(send_whatsapp_message(WhatsAppMessage(
            to=nurse.get("whatsapp_number", ""),
            body=body,
            channel="nurse",
            location={"lat": caller.lat, "lng": caller.lng, "label": "Emergency Location"},
            interactive_buttons=["ON MY WAY", "CAN'T HELP"],
        )))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    for r in results:
        if isinstance(r, WhatsAppDeliveryReceipt):
            receipts.append({
                "message_id": r.message_id,
                "to": r.to,
                "status": r.status,
            })

    return ChannelResult(
        channel="nurse",
        status="dispatched",
        messages_sent=len(receipts),
        details={
            "nurses_alerted": len(receipts),
            "search_radius_km": radius_km,
            "nurses": [
                {"id": n["id"], "name": n["name"], "distance_km": round(d, 2), "specialization": n.get("specialization", "")}
                for n, d in nearby
            ],
        },
        receipts=receipts,
    )


# ---------------------------------------------------------------------------
# Channel 4: Family notification
# ---------------------------------------------------------------------------

async def _dispatch_family(
    assessment: TriageAssessment,
    caller: CallerInfo,
) -> ChannelResult:
    """Notify family/emergency contacts with patient status and location."""
    contacts = caller.family_contacts

    if not contacts:
        # Use a placeholder — in production, contacts come from user profile
        contacts = [{"name": "Emergency Contact", "phone": "+91-98450-99999"}]

    tasks = []
    for contact in contacts:
        body = (
            f"🆘 EMERGENCY ALERT for {caller.name}\n\n"
            f"An emergency has been detected.\n"
            f"Condition: {assessment.likely_condition} ({assessment.severity})\n"
            f"Location: https://maps.google.com/?q={caller.lat},{caller.lng}\n\n"
            f"Ambulance has been dispatched.\n"
            f"We will send updates as the situation progresses.\n\n"
            f"AI-assisted triage — not a medical diagnosis."
        )

        tasks.append(send_whatsapp_message(WhatsAppMessage(
            to=contact.get("phone", ""),
            body=body,
            channel="family",
            location={"lat": caller.lat, "lng": caller.lng, "label": f"Emergency: {caller.name}"},
        )))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    receipts = []
    for r in results:
        if isinstance(r, WhatsAppDeliveryReceipt):
            receipts.append({
                "message_id": r.message_id,
                "to": r.to,
                "status": r.status,
            })

    return ChannelResult(
        channel="family",
        status="dispatched",
        messages_sent=len(receipts),
        details={
            "contacts_notified": len(receipts),
            "contacts": [{"name": c.get("name", ""), "phone": c.get("phone", "")} for c in contacts],
        },
        receipts=receipts,
    )


# ---------------------------------------------------------------------------
# Main orchestrator — fires all channels in parallel
# ---------------------------------------------------------------------------

async def run_dispatch(
    assessment: TriageAssessment,
    caller: CallerInfo,
) -> DispatchResult:
    """Execute parallel dispatch across all channels.

    This is the core of the WhatsApp-first architecture:
    - All 4 channels fire simultaneously
    - Each channel is independent — failure in one doesn't block others
    - Results are collected and returned as a unified dispatch result
    """
    session_id = f"gh_{uuid.uuid4().hex[:12]}"
    timestamp = datetime.now(timezone.utc).isoformat()

    logger.info(
        "Starting dispatch session=%s condition=%s severity=%s location=(%s,%s)",
        session_id, assessment.likely_condition, assessment.severity, caller.lat, caller.lng,
    )

    # Ensure hospitals are loaded
    load_hospitals()

    # Get hospital match first (needed by ambulance channel for destination)
    hospital_match = get_best_hospital(
        required_capabilities=assessment.required_capabilities,
        caller_lat=caller.lat,
        caller_lng=caller.lng,
    )

    # Fire ALL channels in parallel
    hospital_task = _dispatch_hospital(assessment, caller)
    ambulance_task = _dispatch_ambulance(assessment, caller, hospital_match)
    nurse_task = _dispatch_nurses(assessment, caller)
    family_task = _dispatch_family(assessment, caller)

    results = await asyncio.gather(
        hospital_task,
        ambulance_task,
        nurse_task,
        family_task,
        return_exceptions=True,
    )

    # Collect results, handling any exceptions
    channels: list[ChannelResult] = []
    for i, r in enumerate(results):
        if isinstance(r, ChannelResult):
            channels.append(r)
        else:
            channel_names = ["hospital", "ambulance", "nurse", "family"]
            logger.error("Channel %s failed: %s", channel_names[i], r)
            channels.append(ChannelResult(
                channel=channel_names[i],
                status="failed",
                details={"error": str(r)},
            ))

    # Build triage summary for the dispatch result
    triage_summary = {
        "condition": assessment.likely_condition,
        "severity": assessment.severity,
        "esi_level": assessment.esi_level,
        "triage_score": assessment.triage_score,
        "required_capabilities": assessment.required_capabilities,
        "time_criticality_minutes": assessment.time_criticality_minutes,
        "patient_demographics": assessment.patient_demographics,
        "reasoning": assessment.reasoning,
    }

    hospital_match_dict = None
    if hospital_match:
        hospital_match_dict = {
            "hospital_id": hospital_match.hospital.id,
            "hospital_name": hospital_match.hospital.name,
            "distance_km": hospital_match.distance_km,
            "capability_score": hospital_match.capability_score,
            "matched_capabilities": hospital_match.matched_capabilities,
            "missing_capabilities": hospital_match.missing_capabilities,
        }

    total_messages = sum(c.messages_sent for c in channels)
    logger.info(
        "Dispatch complete session=%s channels=%d messages=%d",
        session_id, len(channels), total_messages,
    )

    return DispatchResult(
        session_id=session_id,
        timestamp=timestamp,
        triage_summary=triage_summary,
        channels=channels,
        hospital_match=hospital_match_dict,
        all_messages=get_message_log(),
    )
