"""Real-time WebSocket endpoints + REST fallback for session timeline.

WebSocket: ws://host/api/v1/realtime/ws/dispatch/{session_id}
REST: GET /api/v1/realtime/session/{session_id}/timeline
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from src.backend.realtime.websocket import manager
from src.backend.realtime.pubsub import subscribe_to_session, is_location_active
from src.backend.dispatch.session_store import session_store

logger = logging.getLogger("golden_hour.realtime.router")

router = APIRouter()


@router.websocket("/ws/dispatch/{session_id}")
async def websocket_dispatch(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time dispatch updates.

    Clients connect to receive live state changes for a specific session.
    Events are pushed whenever the state machine transitions.

    If Redis is available, events come from pub/sub.
    If Redis is not available, the connection stays open and receives
    events via the ConnectionManager's broadcast method.
    """
    await manager.connect(websocket, session_id)

    # Send current session state immediately on connect
    session = session_store.get(session_id)
    if session:
        await websocket.send_json({
            "event": "connected",
            "session": session.to_dict(),
        })
    else:
        await websocket.send_json({
            "event": "error",
            "message": f"Session {session_id} not found",
        })

    try:
        # If Redis is available, forward pub/sub events to WebSocket
        async for event in subscribe_to_session(session_id):
            await websocket.send_json(event)

        # If Redis is not available, keep connection alive and wait for messages
        while True:
            # Wait for client messages (heartbeat/close)
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"event": "pong"})

    except WebSocketDisconnect:
        manager.disconnect(websocket, session_id)
    except Exception as e:
        logger.error("WebSocket error for session %s: %s", session_id, e)
        manager.disconnect(websocket, session_id)


@router.get("/session/{session_id}/timeline")
async def get_session_timeline(session_id: str):
    """REST fallback: get the full timeline for a session.

    Use this when WebSocket is not available (polling mode).
    """
    session = session_store.get(session_id)
    if not session:
        return {"error": "Session not found", "session_id": session_id}

    return {
        "session_id": session_id,
        "state": session.state,
        "tracker_stage": session.tracker_stage,
        "tracker_label": session.tracker_label,
        "timeline": session.timeline,
        "is_terminal": session.is_terminal,
    }


@router.get("/session/{session_id}/location-active")
async def check_location_active(session_id: str):
    """Check if location sharing is still active for a session."""
    active = await is_location_active(session_id)
    return {
        "session_id": session_id,
        "location_active": active,
    }


@router.get("/stats")
async def realtime_stats():
    """Get real-time connection statistics."""
    return {
        "total_websocket_connections": manager.get_total_connections(),
    }
