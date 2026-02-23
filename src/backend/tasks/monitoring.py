"""Monitoring tasks — periodic checks for stale dispatches and location expiry.

These tasks run on Celery Beat schedule:
- check_stale_dispatches: every 60s — find sessions stuck in non-terminal states
- expire_location_sharing: every 5min — clean up expired location shares
"""

import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("golden_hour.tasks.monitoring")


def check_stale_dispatches():
    """Find dispatch sessions that haven't progressed in 5+ minutes.

    Checks the in-memory session store for sessions in non-terminal states
    that have gone stale (no timeline entry in 5 minutes).

    Stale sessions in 'dispatching' state trigger escalation.
    """
    from src.backend.dispatch.session_store import session_store

    stale_threshold = timedelta(minutes=5)
    now = datetime.now(timezone.utc)
    stale_count = 0

    for session in session_store.list_active():
        if not session.timeline:
            continue

        last_entry = session.timeline[-1]
        try:
            last_time = datetime.fromisoformat(last_entry["timestamp"])
            if now - last_time > stale_threshold:
                stale_count += 1
                logger.warning(
                    "Stale session %s: state=%s, last_update=%s",
                    session.session_id, session.state, last_entry["timestamp"],
                )

                # Trigger escalation for dispatching sessions
                if session.state in ("dispatching", "ambulance_acked"):
                    session.transition_to("escalate", {"reason": "stale_timeout"})
        except (ValueError, KeyError):
            continue

    if stale_count:
        logger.info("Found %d stale dispatch sessions", stale_count)
    return stale_count


def expire_location_sharing():
    """Expire location sharing for resolved/cancelled sessions.

    Cleans up the session store by marking location sharing as inactive
    for terminal sessions older than 2 hours.
    """
    from src.backend.dispatch.session_store import session_store

    now = datetime.now(timezone.utc)
    expiry_threshold = timedelta(hours=2)
    expired_count = 0

    # Check all sessions (including terminal ones still in memory)
    for session_id in list(session_store._sessions.keys()):
        session = session_store.get(session_id)
        if not session or not session.timeline:
            continue

        # For terminal sessions, check if they've been resolved for 2+ hours
        if session.is_terminal and session.timeline:
            try:
                last_time = datetime.fromisoformat(session.timeline[-1]["timestamp"])
                if now - last_time > expiry_threshold:
                    session_store.remove(session_id)
                    expired_count += 1
            except (ValueError, KeyError):
                continue

    if expired_count:
        logger.info("Expired %d old sessions from store", expired_count)
    return expired_count


# Register as Celery tasks if Celery is available
try:
    from src.backend.tasks.celery_app import get_celery_app
    app = get_celery_app()
    if app:
        check_stale_dispatches = app.task(name="src.backend.tasks.monitoring.check_stale_dispatches")(check_stale_dispatches)
        expire_location_sharing = app.task(name="src.backend.tasks.monitoring.expire_location_sharing")(expire_location_sharing)
except Exception:
    pass  # Functions work as plain functions without Celery
