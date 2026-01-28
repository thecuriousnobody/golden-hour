"""Tests for the triage classification engine."""

import pytest
from fastapi.testclient import TestClient

from src.backend.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_triage_classify_endpoint():
    response = client.post(
        "/api/v1/triage/classify",
        json={
            "transcript": "My father collapsed, holding his chest, sweating heavily",
            "location": {"latitude": 12.9716, "longitude": 77.5946},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "classification" in data
    assert "severity" in data
    assert "confidence" in data
    assert "symptoms_extracted" in data


def test_triage_classify_empty_transcript():
    response = client.post(
        "/api/v1/triage/classify",
        json={"transcript": ""},
    )
    assert response.status_code == 200
