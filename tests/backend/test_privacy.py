"""Tests for privacy controls — location expiry and data handling."""

import asyncio
import pytest


class TestLocationExpiry:
    """Test location sharing auto-expiry logic."""

    def test_location_expiry_constants(self):
        from src.backend.realtime.pubsub import DEFAULT_LOCATION_TTL, MAX_LOCATION_TTL
        assert DEFAULT_LOCATION_TTL == 7200   # 2 hours
        assert MAX_LOCATION_TTL == 21600      # 6 hours

    def test_set_location_expiry_without_redis(self):
        """Without Redis, set_location_expiry returns False."""
        from src.backend.realtime.pubsub import set_location_expiry
        result = asyncio.get_event_loop().run_until_complete(
            set_location_expiry("gh_privacy_test")
        )
        assert result is False

    def test_is_location_active_without_redis(self):
        """Without Redis, is_location_active returns True (fail-open)."""
        from src.backend.realtime.pubsub import is_location_active
        result = asyncio.get_event_loop().run_until_complete(
            is_location_active("gh_privacy_test")
        )
        assert result is True  # Fail-open for emergencies

    def test_location_active_endpoint(self):
        """REST endpoint should check location active status."""
        from fastapi.testclient import TestClient
        from src.backend.main import app
        client = TestClient(app)

        response = client.get("/api/v1/realtime/session/gh_privacy/location-active")
        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == "gh_privacy"
        assert isinstance(data["location_active"], bool)


class TestPrivacyInPipeline:
    """Test that the pipeline includes tracking URL."""

    def test_pipeline_returns_tracking_url(self):
        from fastapi.testclient import TestClient
        from src.backend.main import app
        from src.backend.dispatch.whatsapp import clear_message_log

        client = TestClient(app)
        clear_message_log()

        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "Someone collapsed, chest pain, not breathing",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        assert response.status_code == 200
        data = response.json()

        # Tracking URL should be present
        assert "tracking_url" in data
        assert data["tracking_url"].startswith("https://goldenhour.app/track/gh_")

    def test_pipeline_returns_timeline(self):
        from fastapi.testclient import TestClient
        from src.backend.main import app
        from src.backend.dispatch.whatsapp import clear_message_log

        client = TestClient(app)
        clear_message_log()

        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "Severe chest pain and difficulty breathing",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        data = response.json()

        assert "timeline" in data
        assert isinstance(data["timeline"], list)
        assert len(data["timeline"]) >= 1  # At least 'initiated'

        # Timeline entries should have expected structure
        for entry in data["timeline"]:
            assert "state" in entry
            assert "timestamp" in entry
            assert "tracker_stage" in entry
            assert "tracker_label" in entry
