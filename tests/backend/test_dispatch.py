"""Tests for the parallel dispatch orchestrator."""

import pytest
from fastapi.testclient import TestClient

from src.backend.main import app
from src.backend.dispatch.whatsapp import clear_message_log, get_message_log

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_messages():
    """Clear WhatsApp message log before each test."""
    clear_message_log()


class TestDispatchEndpoint:
    def test_dispatch_with_transcript(self):
        """Dispatch from raw transcript → triage + all 4 channels."""
        response = client.post(
            "/api/v1/dispatch/initiate",
            json={
                "transcript": "He is having chest pain and sweating, please send ambulance",
                "latitude": 12.9716,
                "longitude": 77.5946,
                "caller_name": "Test Caller",
                "caller_phone": "+91-98450-12345",
            },
        )
        assert response.status_code == 200
        data = response.json()

        assert data["session_id"].startswith("gh_")
        assert data["total_messages_sent"] > 0
        assert len(data["channels"]) == 4

        # Check each channel exists
        channel_names = [c["channel"] for c in data["channels"]]
        assert "hospital" in channel_names
        assert "ambulance" in channel_names
        assert "nurse" in channel_names
        assert "family" in channel_names

    def test_dispatch_hospital_channel(self):
        """Hospital channel should match based on triage capabilities."""
        response = client.post(
            "/api/v1/dispatch/initiate",
            json={
                "transcript": "Cardiac arrest, not breathing, needs defibrillator",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        data = response.json()

        hospital_channel = next(c for c in data["channels"] if c["channel"] == "hospital")
        assert hospital_channel["status"] == "dispatched"
        assert hospital_channel["messages_sent"] == 1
        assert "hospital_name" in hospital_channel["details"]

    def test_dispatch_ambulance_channel(self):
        """Ambulance channel should dispatch nearest available."""
        response = client.post(
            "/api/v1/dispatch/initiate",
            json={
                "transcript": "Someone is unconscious on the street",
                "latitude": 12.9500,
                "longitude": 77.6100,
            },
        )
        data = response.json()

        ambulance_channel = next(c for c in data["channels"] if c["channel"] == "ambulance")
        assert ambulance_channel["status"] == "dispatched"
        assert "ambulance_name" in ambulance_channel["details"]
        assert ambulance_channel["details"]["distance_km"] >= 0

    def test_dispatch_nurse_channel(self):
        """Nurse pager should alert nearby available nurses."""
        response = client.post(
            "/api/v1/dispatch/initiate",
            json={
                "transcript": "Heavy bleeding from a wound, needs help",
                "latitude": 12.9700,
                "longitude": 77.6000,
            },
        )
        data = response.json()

        nurse_channel = next(c for c in data["channels"] if c["channel"] == "nurse")
        # Should either dispatch or have no match (depends on radius)
        assert nurse_channel["status"] in ["dispatched", "no_match"]

    def test_dispatch_family_channel(self):
        """Family notification should be sent."""
        response = client.post(
            "/api/v1/dispatch/initiate",
            json={
                "transcript": "Child fell from balcony and is crying",
                "latitude": 12.9716,
                "longitude": 77.5946,
                "family_contacts": [
                    {"name": "Mother", "phone": "+91-98765-11111"},
                    {"name": "Father", "phone": "+91-98765-22222"},
                ],
            },
        )
        data = response.json()

        family_channel = next(c for c in data["channels"] if c["channel"] == "family")
        assert family_channel["status"] == "dispatched"
        assert family_channel["messages_sent"] == 2

    def test_dispatch_triage_summary(self):
        """Dispatch should include triage summary."""
        response = client.post(
            "/api/v1/dispatch/initiate",
            json={
                "transcript": "Snake bit his leg, area is swelling fast",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        data = response.json()

        assert "triage_summary" in data
        summary = data["triage_summary"]
        assert "condition" in summary
        assert "severity" in summary
        assert "esi_level" in summary

    def test_dispatch_messages_logged(self):
        """All dispatched WhatsApp messages should be accessible via /messages endpoint."""
        # First dispatch
        client.post(
            "/api/v1/dispatch/initiate",
            json={
                "transcript": "Chest pain emergency",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )

        # Then check messages
        response = client.get("/api/v1/dispatch/messages")
        assert response.status_code == 200
        messages = response.json()["messages"]
        assert len(messages) > 0

        # Each message should have required fields
        for msg in messages:
            assert "message_id" in msg
            assert "to" in msg
            assert "body" in msg
            assert "channel" in msg

    def test_dispatch_no_input_returns_error(self):
        """Dispatch without transcript or triage_result should handle gracefully."""
        response = client.post(
            "/api/v1/dispatch/initiate",
            json={
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == "error"


class TestWhatsAppMessages:
    def test_hospital_message_content(self):
        """Hospital WhatsApp message should contain key medical info."""
        client.post(
            "/api/v1/dispatch/initiate",
            json={
                "transcript": "Severe chest pain and difficulty breathing",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )

        messages = get_message_log()
        hospital_msgs = [m for m in messages if m["channel"] == "hospital"]
        assert len(hospital_msgs) > 0

        body = hospital_msgs[0]["body"]
        assert "INCOMING EMERGENCY" in body
        assert "ESI-" in body
        assert "AI-assisted triage" in body

    def test_ambulance_message_has_maps_link(self):
        """Ambulance message should include Google Maps link."""
        client.post(
            "/api/v1/dispatch/initiate",
            json={
                "transcript": "Person not breathing on the road",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )

        messages = get_message_log()
        ambulance_msgs = [m for m in messages if m["channel"] == "ambulance"]
        assert len(ambulance_msgs) > 0

        body = ambulance_msgs[0]["body"]
        assert "maps.google.com" in body
        assert "12.9716" in body
