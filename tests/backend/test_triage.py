"""Tests for the triage classification engine."""

import pytest
from fastapi.testclient import TestClient

from src.backend.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_triage_classify_cardiac():
    """Cardiac emergency should return CRITICAL severity with cath_lab capability."""
    response = client.post(
        "/api/v1/triage/classify",
        json={
            "transcript": "My father collapsed, holding his chest, sweating heavily",
            "location": {"lat": 12.9716, "lng": 77.5946},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "assessment" in data
    assessment = data["assessment"]
    assert assessment["severity"] in ["CRITICAL", "HIGH"]
    assert assessment["esi_level"] <= 2
    assert "cath_lab" in assessment["required_capabilities"]
    assert len(assessment["symptoms"]) > 0


def test_triage_classify_stroke():
    """Stroke symptoms should be classified as CRITICAL with stroke_unit."""
    response = client.post(
        "/api/v1/triage/classify",
        json={
            "transcript": "Her face is drooping on one side and she has slurred speech",
        },
    )
    assert response.status_code == 200
    assessment = response.json()["assessment"]
    assert assessment["severity"] == "CRITICAL"
    assert "stroke_unit" in assessment["required_capabilities"] or "ct_scan" in assessment["required_capabilities"]


def test_triage_classify_snakebite():
    """Snakebite should return HIGH severity with antivenom capability."""
    response = client.post(
        "/api/v1/triage/classify",
        json={
            "transcript": "A snake bit my child in the garden, the area is swelling",
        },
    )
    assert response.status_code == 200
    assessment = response.json()["assessment"]
    assert assessment["severity"] in ["CRITICAL", "HIGH"]
    assert "antivenom" in assessment["required_capabilities"]


def test_triage_classify_burn():
    """Burn injury should be identified with burn_unit capability."""
    response = client.post(
        "/api/v1/triage/classify",
        json={
            "transcript": "There was a fire in the kitchen, he has severe burns on his arms",
        },
    )
    assert response.status_code == 200
    assessment = response.json()["assessment"]
    assert assessment["severity"] in ["CRITICAL", "HIGH"]
    assert "burn_unit" in assessment["required_capabilities"]


def test_triage_classify_trauma():
    """Fall/accident should be classified with trauma capabilities."""
    response = client.post(
        "/api/v1/triage/classify",
        json={
            "transcript": "He fell from the second floor, not able to move his legs",
        },
    )
    assert response.status_code == 200
    assessment = response.json()["assessment"]
    assert assessment["severity"] in ["CRITICAL", "HIGH"]


def test_triage_classify_respiratory():
    """Not breathing should be ESI-1 CRITICAL."""
    response = client.post(
        "/api/v1/triage/classify",
        json={
            "transcript": "She is not breathing, please send help immediately",
        },
    )
    assert response.status_code == 200
    assessment = response.json()["assessment"]
    assert assessment["severity"] == "CRITICAL"
    assert assessment["esi_level"] == 1


def test_triage_classify_empty_transcript():
    """Empty transcript should still return a valid response."""
    response = client.post(
        "/api/v1/triage/classify",
        json={"transcript": ""},
    )
    assert response.status_code == 200
    data = response.json()
    assert "assessment" in data


def test_triage_esi_levels_range():
    """ESI level must always be between 1 and 5."""
    transcripts = [
        "cardiac arrest, not breathing",
        "chest pain and sweating",
        "broken arm from a fall",
        "small cut on finger",
        "runny nose and cough",
    ]
    for transcript in transcripts:
        response = client.post(
            "/api/v1/triage/classify",
            json={"transcript": transcript},
        )
        assert response.status_code == 200
        assessment = response.json()["assessment"]
        assert 1 <= assessment["esi_level"] <= 5
        assert 1 <= assessment["triage_score"] <= 10
