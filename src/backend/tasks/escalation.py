"""Escalation tasks — expand responder search radius on timeout.

Escalation strategy:
1. Initial dispatch: 5km radius
2. After 2 minutes: expand to 10km
3. After 4 minutes: expand to 15km
4. After 6 minutes: alert all available responders + notify family of delay
"""

import logging

logger = logging.getLogger("golden_hour.tasks.escalation")

# Escalation radius tiers (km)
RADIUS_TIERS = [5, 10, 15]


def escalation_timer(session_id: str, tier: int = 0):
    """Escalation timer — dispatches to wider radius.

    Called by Celery after a countdown when initial responders
    don't acknowledge. Each tier expands the search radius.

    Args:
        session_id: The dispatch session to escalate
        tier: Current escalation tier (0=5km, 1=10km, 2=15km)
    """
    from src.backend.dispatch.session_store import session_store

    session = session_store.get(session_id)
    if not session:
        logger.warning("Escalation: session %s not found", session_id)
        return

    # Skip if session has already progressed past dispatching
    if session.state not in ("dispatching", "escalated"):
        logger.info(
            "Escalation skipped: session %s is in state %s",
            session_id, session.state,
        )
        return

    radius = RADIUS_TIERS[min(tier, len(RADIUS_TIERS) - 1)]
    logger.warning(
        "ESCALATION tier %d: session %s expanding radius to %dkm",
        tier, session_id, radius,
    )

    # Transition to escalated state
    session.transition_to("escalate", {
        "tier": tier,
        "radius_km": radius,
        "reason": "no_acknowledgement_timeout",
    })

    # Schedule next tier if not at max
    if tier < len(RADIUS_TIERS) - 1:
        try:
            from src.backend.tasks.celery_app import schedule_task
            schedule_task(
                "src.backend.tasks.escalation.escalation_timer",
                kwargs={"session_id": session_id, "tier": tier + 1},
                countdown=120,  # 2 minutes between tiers
            )
        except Exception:
            pass  # Best-effort

    return {
        "session_id": session_id,
        "tier": tier,
        "radius_km": radius,
        "state": session.state,
    }


# Register as Celery task if available
try:
    from src.backend.tasks.celery_app import get_celery_app
    app = get_celery_app()
    if app:
        escalation_timer = app.task(name="src.backend.tasks.escalation.escalation_timer")(escalation_timer)
except Exception:
    pass
