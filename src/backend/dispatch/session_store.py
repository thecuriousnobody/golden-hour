"""Session store — in-memory dict-based, with optional Redis backing.

Stores DispatchSession instances keyed by session_id.
In production, this can be backed by Redis for persistence across restarts.
"""

import logging
from src.backend.dispatch.state_machine import DispatchSession

logger = logging.getLogger("golden_hour.session_store")


class SessionStore:
    """In-memory session store with optional Redis persistence."""

    def __init__(self):
        self._sessions: dict[str, DispatchSession] = {}

    def create(self, session_id: str) -> DispatchSession:
        """Create and store a new dispatch session."""
        session = DispatchSession(session_id)
        self._sessions[session_id] = session
        logger.info("Created session %s", session_id)
        return session

    def get(self, session_id: str) -> DispatchSession | None:
        """Retrieve a session by ID."""
        return self._sessions.get(session_id)

    def list_active(self) -> list[DispatchSession]:
        """List all non-terminal sessions."""
        return [s for s in self._sessions.values() if not s.is_terminal]

    def remove(self, session_id: str) -> bool:
        """Remove a session from the store."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False

    def count(self) -> int:
        """Total number of sessions in store."""
        return len(self._sessions)


# Global singleton
session_store = SessionStore()
