"""Tests for WebSocket real-time updates and REST timeline fallback."""

import pytest
from fastapi.testclient import TestClient

from src.backend.main import app
from src.backend.dispatch.session_store import session_store

client = TestClient(app)


class TestRealtimeREST:
    """Test the REST fallback endpoints for session timeline."""

    def _create_session(self) -> str:
        """Helper: create a session via the dispatch endpoint."""
        from src.backend.dispatch.whatsapp import clear_message_log
        clear_message_log()
        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "Chest pain emergency",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        return response.json()["session_id"]

    def test_timeline_endpoint(self):
        """GET /realtime/session/{id}/timeline should return timeline."""
        session_id = self._create_session()
        response = client.get(f"/api/v1/realtime/session/{session_id}/timeline")
        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == session_id
        assert "timeline" in data
        assert len(data["timeline"]) >= 1
        assert "state" in data
        assert "tracker_stage" in data

    def test_timeline_nonexistent_session(self):
        """Nonexistent session should return error."""
        response = client.get("/api/v1/realtime/session/gh_nonexistent/timeline")
        assert response.status_code == 200
        data = response.json()
        assert "error" in data

    def test_location_active_endpoint(self):
        """Location active check should return a boolean."""
        response = client.get("/api/v1/realtime/session/gh_test/location-active")
        assert response.status_code == 200
        data = response.json()
        assert "location_active" in data
        assert isinstance(data["location_active"], bool)

    def test_realtime_stats(self):
        """Stats endpoint should return connection count."""
        response = client.get("/api/v1/realtime/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total_websocket_connections" in data
        assert data["total_websocket_connections"] >= 0


class TestWebSocketConnection:
    """Test WebSocket connections."""

    def test_websocket_connect_with_session(self):
        """WebSocket should connect and receive session state."""
        # First create a session
        session_id = self._create_session()

        with client.websocket_connect(f"/api/v1/realtime/ws/dispatch/{session_id}") as ws:
            data = ws.receive_json()
            assert data["event"] == "connected"
            assert "session" in data
            assert data["session"]["session_id"] == session_id

    def test_websocket_connect_nonexistent(self):
        """WebSocket should connect but report error for missing session."""
        with client.websocket_connect("/api/v1/realtime/ws/dispatch/gh_doesntexist") as ws:
            data = ws.receive_json()
            assert data["event"] == "error"

    def _create_session(self) -> str:
        from src.backend.dispatch.whatsapp import clear_message_log
        clear_message_log()
        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "Someone is not breathing",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        return response.json()["session_id"]


class TestConnectionManager:
    """Test the WebSocket connection manager directly."""

    def test_manager_import(self):
        from src.backend.realtime.websocket import ConnectionManager
        mgr = ConnectionManager()
        assert mgr.get_total_connections() == 0

    def test_manager_connection_count(self):
        from src.backend.realtime.websocket import ConnectionManager
        mgr = ConnectionManager()
        assert mgr.get_connection_count("gh_test") == 0


class TestPubSub:
    """Test pub/sub module imports and graceful degradation."""

    def test_pubsub_import(self):
        from src.backend.realtime.pubsub import publish_event, subscribe_to_session
        assert publish_event is not None
        assert subscribe_to_session is not None

    def test_check_redis_no_connection(self):
        """check_redis_connection should return False without Redis."""
        import asyncio
        from src.backend.realtime.pubsub import check_redis_connection
        result = asyncio.get_event_loop().run_until_complete(check_redis_connection())
        assert isinstance(result, bool)

    def test_publish_without_redis(self):
        """publish_event should return False gracefully without Redis."""
        import asyncio
        from src.backend.realtime.pubsub import publish_event
        result = asyncio.get_event_loop().run_until_complete(
            publish_event("gh_test", "test_event", {"key": "value"})
        )
        assert result is False

    def test_location_active_without_redis(self):
        """is_location_active should return True (fail-open) without Redis."""
        import asyncio
        from src.backend.realtime.pubsub import is_location_active
        result = asyncio.get_event_loop().run_until_complete(
            is_location_active("gh_test")
        )
        assert result is True  # Fail-open for emergencies
