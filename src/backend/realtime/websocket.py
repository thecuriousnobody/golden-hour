"""WebSocket connection manager for real-time dispatch updates.

Manages per-session WebSocket connections so multiple clients
(family tracking page, dispatch dashboard, etc.) can receive
live state machine updates for a specific session.
"""

import json
import logging
from fastapi import WebSocket

logger = logging.getLogger("golden_hour.realtime.websocket")


class ConnectionManager:
    """Manages WebSocket connections grouped by session ID."""

    def __init__(self):
        # session_id -> set of WebSocket connections
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        """Accept a WebSocket connection and register it for a session."""
        await websocket.accept()
        if session_id not in self._connections:
            self._connections[session_id] = set()
        self._connections[session_id].add(websocket)
        logger.info("WebSocket connected for session %s (total: %d)", session_id, len(self._connections[session_id]))

    def disconnect(self, websocket: WebSocket, session_id: str):
        """Remove a WebSocket connection."""
        if session_id in self._connections:
            self._connections[session_id].discard(websocket)
            if not self._connections[session_id]:
                del self._connections[session_id]
        logger.info("WebSocket disconnected for session %s", session_id)

    async def broadcast_to_session(self, session_id: str, data: dict):
        """Send a message to all WebSocket connections for a session."""
        connections = self._connections.get(session_id, set())
        dead = set()

        for ws in connections:
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)

        # Clean up dead connections
        for ws in dead:
            self.disconnect(ws, session_id)

    async def broadcast_state_change(self, session_id: str, state: str, timeline: list[dict]):
        """Broadcast a state change event to all session watchers."""
        await self.broadcast_to_session(session_id, {
            "event": "state_change",
            "session_id": session_id,
            "state": state,
            "timeline": timeline,
        })

    def get_connection_count(self, session_id: str) -> int:
        """Number of active connections for a session."""
        return len(self._connections.get(session_id, set()))

    def get_total_connections(self) -> int:
        """Total active WebSocket connections across all sessions."""
        return sum(len(conns) for conns in self._connections.values())


# Global singleton
manager = ConnectionManager()
