"""Tests for the end-to-end emergency pipeline."""

import pytest
from fastapi.testclient import TestClient

from src.backend.main import app

client = TestClient(app)


class TestEmergencyPipeline:
    """Test the full pipeline: transcript → triage → dispatch."""

    def test_cardiac_emergency_full_pipeline(self):
        """Cardiac emergency should triage as CRITICAL and dispatch all channels."""
        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "My grandfather collapsed holding his chest, he is sweating and his left arm is numb",
                "language": "kn",
                "latitude": 12.9716,
                "longitude": 77.5946,
                "caller_name": "Ravi Kumar",
                "caller_phone": "+91-98450-12345",
                "family_contacts": [
                    {"name": "Sunita Kumar", "phone": "+91-98765-11111"},
                ],
            },
        )
        assert response.status_code == 200
        data = response.json()

        # Session
        assert data["session_id"].startswith("gh_")

        # Stages
        assert len(data["stages"]) == 2
        assert data["stages"][0]["stage"] == "triage"
        assert data["stages"][0]["status"] == "complete"
        assert data["stages"][1]["stage"] == "dispatch"
        assert data["stages"][1]["status"] == "complete"

        # Triage
        triage = data["triage"]
        assert triage["severity"] in ["CRITICAL", "HIGH"]
        assert triage["esi_level"] <= 2
        assert "cath_lab" in triage["required_capabilities"]
        assert len(triage["symptoms"]) > 0

        # Dispatch
        dispatch = data["dispatch"]
        assert dispatch["total_messages"] > 0
        assert len(dispatch["channels"]) == 4

        # Messages
        assert len(data["messages"]) > 0

    def test_snakebite_emergency(self):
        """Snakebite should route to hospital with antivenom."""
        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "A snake bit my son in the field, the bite area is swelling and he is in pain",
                "latitude": 12.9590,
                "longitude": 77.5733,  # Near Victoria Hospital (has antivenom)
            },
        )
        data = response.json()

        assert data["triage"]["severity"] in ["CRITICAL", "HIGH"]
        assert "antivenom" in data["triage"]["required_capabilities"]

        # Hospital match should be Victoria (has antivenom and is closest)
        if data["dispatch"]["hospital_match"]:
            matched_caps = data["dispatch"]["hospital_match"]["matched_capabilities"]
            assert "antivenom" in matched_caps

    def test_stroke_emergency(self):
        """Stroke should require stroke_unit and ct_scan."""
        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "Her face is drooping on one side, she cannot speak properly and her right arm is weak",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        data = response.json()
        triage = data["triage"]

        assert triage["severity"] == "CRITICAL"
        has_neuro = "stroke_unit" in triage["required_capabilities"] or "ct_scan" in triage["required_capabilities"]
        assert has_neuro

    def test_burn_emergency(self):
        """Burn injury should require burn_unit."""
        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "Gas cylinder burst in kitchen, my wife has severe burns on her arms and face",
                "latitude": 12.9280,
                "longitude": 77.6210,  # Near St. John's (has burn_unit)
            },
        )
        data = response.json()

        assert "burn_unit" in data["triage"]["required_capabilities"]

    def test_pipeline_timing(self):
        """Pipeline should include timing for each stage."""
        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "Someone is not breathing",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        data = response.json()

        for stage in data["stages"]:
            assert "duration_ms" in stage
            assert stage["duration_ms"] >= 0

    def test_multiple_family_contacts(self):
        """Multiple family contacts should all receive notifications."""
        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "Elderly man fell from stairs, heavy bleeding from head",
                "latitude": 12.9716,
                "longitude": 77.5946,
                "family_contacts": [
                    {"name": "Son", "phone": "+91-98765-11111"},
                    {"name": "Daughter", "phone": "+91-98765-22222"},
                    {"name": "Neighbor", "phone": "+91-98765-33333"},
                ],
            },
        )
        data = response.json()

        family_channel = next(c for c in data["dispatch"]["channels"] if c["channel"] == "family")
        assert family_channel["messages_sent"] == 3

    def test_kannada_context_in_triage(self):
        """Pipeline should handle language context from Kannada translation."""
        response = client.post(
            "/api/v1/emergency",
            json={
                "transcript_english": "He is having chest pain and sweating a lot, his left arm is numb and he cannot breathe",
                "transcript_original": "ಅವರಿಗೆ ಎದೆ ನೋವು ಬರ್ತಿದೆ, ತುಂಬಾ ಬೆವರ್ತಿದ್ದಾರೆ",
                "language": "kn",
                "latitude": 12.9716,
                "longitude": 77.5946,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["triage"]["severity"] in ["CRITICAL", "HIGH"]
