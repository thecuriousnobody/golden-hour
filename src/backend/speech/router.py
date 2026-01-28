"""Speech processing and transcription endpoints."""

from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel

router = APIRouter()


class TranscriptionResult(BaseModel):
    text: str
    language: str
    confidence: float
    timestamps: list[dict] = []


@router.post("/transcribe", response_model=TranscriptionResult)
async def transcribe_audio(audio: UploadFile = File(...)):
    """Transcribe emergency audio in any Indian language."""
    # TODO: Integrate Bhashini/Sarvam AI STT
    return TranscriptionResult(
        text="",
        language="unknown",
        confidence=0.0,
        timestamps=[],
    )
