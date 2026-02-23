"""Tests for speech transcription in stub mode."""

import io
import pytest
from fastapi.testclient import TestClient

from src.backend.main import app

client = TestClient(app)


class TestSpeechEndpoint:
    """Test speech transcription endpoint (stub mode)."""

    def test_transcribe_returns_result(self):
        """POST /speech/transcribe should return a transcription result."""
        # Create a fake audio file
        audio_content = b"fake audio data for testing"
        response = client.post(
            "/api/v1/speech/transcribe",
            files={"audio": ("test.wav", io.BytesIO(audio_content), "audio/wav")},
        )
        assert response.status_code == 200
        data = response.json()
        assert "text" in data
        assert "language" in data
        assert "confidence" in data
        assert "source" in data

    def test_transcribe_with_language_hint(self):
        """Transcription should accept language hint."""
        audio_content = b"fake audio"
        response = client.post(
            "/api/v1/speech/transcribe",
            files={"audio": ("test.wav", io.BytesIO(audio_content), "audio/wav")},
            data={"language_hint": "kn"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["language"] == "kn"

    def test_transcribe_stub_mode(self):
        """Without SARVAM_API_KEY, should use stub mode."""
        audio_content = b"test audio bytes"
        response = client.post(
            "/api/v1/speech/transcribe",
            files={"audio": ("recording.mp3", io.BytesIO(audio_content), "audio/mpeg")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "stub"
        assert data["confidence"] == 0.0

    def test_transcribe_returns_original_text(self):
        """Result should include original_text field."""
        audio_content = b"audio data"
        response = client.post(
            "/api/v1/speech/transcribe",
            files={"audio": ("test.wav", io.BytesIO(audio_content), "audio/wav")},
            data={"language_hint": "kn"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "original_text" in data
        assert len(data["original_text"]) > 0


class TestSarvamClient:
    """Test the Sarvam client directly."""

    def test_import_sarvam(self):
        from src.backend.speech.sarvam import transcribe_audio, SarvamTranscription
        assert transcribe_audio is not None
        assert SarvamTranscription is not None

    def test_language_mapping(self):
        from src.backend.speech.sarvam import SARVAM_LANGUAGES
        assert SARVAM_LANGUAGES["kn"] == "kn-IN"
        assert SARVAM_LANGUAGES["hi"] == "hi-IN"
        assert SARVAM_LANGUAGES["ta"] == "ta-IN"
        assert SARVAM_LANGUAGES["te"] == "te-IN"
        assert SARVAM_LANGUAGES["en"] == "en-IN"

    def test_stub_transcription(self):
        import asyncio
        from src.backend.speech.sarvam import transcribe_audio
        result = asyncio.get_event_loop().run_until_complete(
            transcribe_audio(b"fake audio", "test.wav", "hi")
        )
        assert result.source == "stub"
        assert result.language == "hi"
        assert len(result.text) > 0
