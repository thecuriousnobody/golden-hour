"""Redis pub/sub wrapper — graceful degradation if Redis unavailable.

Publishes state machine events so WebSocket connections and other consumers
can receive real-time updates. Falls back silently to no-op if Redis is not
configured or not running.

Also provides location expiry via Redis TTL keys (DPDPA Section 7(d) compliance).
"""

import json
import os
import logging
from datetime import datetime, timezone

logger = logging.getLogger("golden_hour.realtime.pubsub")

_redis_client = None
_redis_available = False


def _get_redis():
    """Lazy-init Redis client. Returns None if unavailable."""
    global _redis_client, _redis_available

    if _redis_client is not None:
        return _redis_client if _redis_available else None

    redis_url = os.getenv("REDIS_URL", "")
    if not redis_url:
        _redis_available = False
        logger.info("REDIS_URL not set — real-time pub/sub disabled")
        return None

    try:
        import redis.asyncio as aioredis
        _redis_client = aioredis.from_url(redis_url, decode_responses=True)
        _redis_available = True
        logger.info("Redis connected for pub/sub")
        return _redis_client
    except Exception as e:
        _redis_available = False
        logger.warning("Redis connection failed (non-blocking): %s", e)
        return None


async def check_redis_connection() -> bool:
    """Test Redis connection. Returns True if connected, False otherwise."""
    r = _get_redis()
    if r is None:
        return False
    try:
        await r.ping()
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Pub/Sub for session events
# ---------------------------------------------------------------------------

async def publish_event(session_id: str, event_type: str, data: dict) -> bool:
    """Publish a session event to Redis pub/sub channel.

    Channel name: `dispatch:{session_id}`

    Args:
        session_id: The dispatch session ID (e.g. "gh_abc123")
        event_type: Event type (e.g. "state_change", "location_update")
        data: Event payload

    Returns:
        True if published, False if Redis unavailable.
    """
    r = _get_redis()
    if r is None:
        return False

    channel = f"dispatch:{session_id}"
    message = json.dumps({
        "event": event_type,
        "session_id": session_id,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    try:
        await r.publish(channel, message)
        logger.debug("Published %s to %s", event_type, channel)
        return True
    except Exception as e:
        logger.error("Failed to publish event: %s", e)
        return False


async def subscribe_to_session(session_id: str):
    """Subscribe to a session's event channel.

    Yields parsed event dicts. Used by WebSocket handler.

    Usage:
        async for event in subscribe_to_session("gh_abc123"):
            await websocket.send_json(event)
    """
    r = _get_redis()
    if r is None:
        logger.warning("Cannot subscribe — Redis unavailable")
        return

    channel = f"dispatch:{session_id}"
    pubsub = r.pubsub()
    await pubsub.subscribe(channel)

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    event = json.loads(message["data"])
                    yield event
                except json.JSONDecodeError:
                    continue
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()


# ---------------------------------------------------------------------------
# Location privacy — auto-expiry via Redis TTL
# ---------------------------------------------------------------------------

DEFAULT_LOCATION_TTL = 7200  # 2 hours
MAX_LOCATION_TTL = 21600     # 6 hours hard limit


async def set_location_expiry(
    session_id: str,
    ttl_seconds: int = DEFAULT_LOCATION_TTL,
) -> bool:
    """Set location sharing auto-expiry for a session.

    After TTL expires, location sharing is automatically disabled.
    Default 2 hours, max 6 hours (DPDPA compliance).

    Returns True if set, False if Redis unavailable.
    """
    r = _get_redis()
    if r is None:
        return False

    ttl = min(ttl_seconds, MAX_LOCATION_TTL)
    key = f"location_active:{session_id}"

    try:
        await r.setex(key, ttl, "1")
        logger.info("Location expiry set for %s: %ds", session_id, ttl)
        return True
    except Exception as e:
        logger.error("Failed to set location expiry: %s", e)
        return False


async def is_location_active(session_id: str) -> bool:
    """Check if location sharing is still active for a session.

    Returns True if active (key exists and hasn't expired), False otherwise.
    When Redis is unavailable, defaults to True (fail-open for emergencies).
    """
    r = _get_redis()
    if r is None:
        return True  # Fail-open: allow location sharing if Redis is down

    key = f"location_active:{session_id}"
    try:
        return await r.exists(key) > 0
    except Exception:
        return True  # Fail-open
