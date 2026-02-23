"""Speech processing and transcription endpoints."""

from fastapi import APIRouter, UploadFile, File, Form
from pydantic import BaseModel

from src.backend.speech.sarvam import transcribe_audio

router = APIRouter()


class TranscriptionResult(BaseModel):
    text: str
    original_text: str = ""
    language: str
    confidence: float
    timestamps: list[dict] = []
    source: str = "stub"


@router.post("/transcribe", response_model=TranscriptionResult)
async def transcribe_emergency_audio(
    audio: UploadFile = File(...),
    language_hint: str = Form(default=""),
):
    """Transcribe emergency audio in any Indian language.

    Supports: Kannada, Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, Malayalam, Punjabi, English.

    Uses Sarvam AI for STT + translation to English.
    Falls back to stub mode if SARVAM_API_KEY is not set.
    """
    audio_data = await audio.read()

    result = await transcribe_audio(
        audio_data=audio_data,
        filename=audio.filename or "audio.wav",
        language_hint=language_hint or None,
    )

    return TranscriptionResult(
        text=result.text,
        original_text=result.original_text,
        language=result.language,
        confidence=result.confidence,
        timestamps=result.timestamps,
        source=result.source,
    )
