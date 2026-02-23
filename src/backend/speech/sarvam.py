"""Sarvam AI Speech-to-Text client with stub/real dual mode.

Follows the same pattern as WhatsApp: check env var, use stub if absent.

Sarvam AI provides:
- STT: Transcription in Indian languages (Kannada, Hindi, Tamil, Telugu, etc.)
- Translation: Indic-to-English translation
- Language detection

Usage:
    result = await transcribe_audio(audio_bytes, filename="recording.wav")
    # result.text = English translation
    # result.original_text = Original language text
    # result.language = Detected language code
"""

import os
import uuid
import logging
from dataclasses import dataclass

logger = logging.getLogger("golden_hour.speech.sarvam")

# Language code mapping for Sarvam
SARVAM_LANGUAGES = {
    "kn": "kn-IN",  # Kannada
    "hi": "hi-IN",  # Hindi
    "ta": "ta-IN",  # Tamil
    "te": "te-IN",  # Telugu
    "en": "en-IN",  # English (Indian)
    "mr": "mr-IN",  # Marathi
    "bn": "bn-IN",  # Bengali
    "gu": "gu-IN",  # Gujarati
    "ml": "ml-IN",  # Malayalam
    "pa": "pa-IN",  # Punjabi
}


@dataclass
class SarvamTranscription:
    """Result from Sarvam STT + translation."""
    text: str                          # English translation
    original_text: str                 # Text in original language
    language: str                      # Detected language code (e.g. "kn")
    confidence: float                  # Transcription confidence (0-1)
    timestamps: list[dict]             # Word-level timestamps if available
    source: str = "stub"               # "sarvam" or "stub"


async def transcribe_audio(
    audio_data: bytes,
    filename: str = "audio.wav",
    language_hint: str | None = None,
) -> SarvamTranscription:
    """Transcribe audio using Sarvam AI (or stub).

    Args:
        audio_data: Raw audio bytes (WAV, MP3, etc.)
        filename: Original filename (used for format detection)
        language_hint: Optional language code hint (e.g. "kn" for Kannada)

    Returns:
        SarvamTranscription with English text and original language text.
    """
    api_key = os.getenv("SARVAM_API_KEY", "")
    if api_key and not api_key.startswith("your_"):
        return await _transcribe_real(audio_data, filename, language_hint, api_key)
    else:
        return await _transcribe_stub(audio_data, filename, language_hint)


async def _transcribe_stub(
    audio_data: bytes,
    filename: str,
    language_hint: str | None,
) -> SarvamTranscription:
    """Stub: return simulated transcription for prototype testing."""
    logger.info(
        "[SARVAM-STUB] Transcribing %s (%d bytes), language_hint=%s",
        filename, len(audio_data), language_hint,
    )

    return SarvamTranscription(
        text="[Stub transcription] Emergency audio received",
        original_text="[Stub] ಆಡಿಯೋ ಸ್ವೀಕರಿಸಲಾಗಿದೆ" if language_hint == "kn" else "[Stub] Original text",
        language=language_hint or "unknown",
        confidence=0.0,
        timestamps=[],
        source="stub",
    )


async def _transcribe_real(
    audio_data: bytes,
    filename: str,
    language_hint: str | None,
    api_key: str,
) -> SarvamTranscription:
    """Real Sarvam AI STT + translation.

    Uses Sarvam's /speech-to-text and /translate endpoints.
    """
    import httpx

    base_url = "https://api.sarvam.ai"
    headers = {"API-Subscription-Key": api_key}

    # Determine content type from filename
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
    content_types = {
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
        "webm": "audio/webm",
        "m4a": "audio/mp4",
    }
    content_type = content_types.get(ext, "audio/wav")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Step 1: Speech-to-Text
            stt_data = {
                "language_code": SARVAM_LANGUAGES.get(language_hint, "hi-IN") if language_hint else "hi-IN",
                "model": "saarika:v2",
                "with_timestamps": "true",
            }

            files = {"file": (filename, audio_data, content_type)}

            stt_response = await client.post(
                f"{base_url}/speech-to-text",
                headers=headers,
                data=stt_data,
                files=files,
            )
            stt_response.raise_for_status()
            stt_result = stt_response.json()

            original_text = stt_result.get("transcript", "")
            detected_lang = language_hint or "hi"
            timestamps = stt_result.get("timestamps", [])

            # Step 2: Translate to English (if not already English)
            english_text = original_text
            if detected_lang != "en" and original_text:
                translate_response = await client.post(
                    f"{base_url}/translate",
                    headers=headers,
                    json={
                        "input": original_text,
                        "source_language_code": SARVAM_LANGUAGES.get(detected_lang, "hi-IN"),
                        "target_language_code": "en-IN",
                        "model": "mayura:v1",
                    },
                )
                if translate_response.status_code == 200:
                    english_text = translate_response.json().get("translated_text", original_text)

            return SarvamTranscription(
                text=english_text,
                original_text=original_text,
                language=detected_lang,
                confidence=stt_result.get("confidence", 0.8),
                timestamps=timestamps,
                source="sarvam",
            )

    except Exception as e:
        logger.error("Sarvam STT failed: %s", e)
        # Fall back to stub on error
        return await _transcribe_stub(audio_data, filename, language_hint)
