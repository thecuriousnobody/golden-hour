/**
 * Sarvam AI Speech-to-Text Translation Service
 * Uses Saaras model for speech-to-English translation
 */

const SARVAM_API_URL = 'https://api.sarvam.ai/speech-to-text-translate';

export interface TranscriptionResult {
  transcript: string;
  languageDetected: string;
  confidence: number;
}

export async function translateSpeechToEnglish(
  audioBlob: Blob
): Promise<TranscriptionResult> {
  const apiKey = import.meta.env.VITE_SARVAM_API_KEY;

  if (!apiKey) {
    throw new Error('VITE_SARVAM_API_KEY not configured');
  }

  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.wav');
  formData.append('model', 'saaras:v2.5');

  const response = await fetch(SARVAM_API_URL, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sarvam API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    transcript: data.transcript || data.text || '',
    languageDetected: data.language_code || data.language || 'unknown',
    confidence: data.confidence || 0.95,
  };
}

// Language code to display name mapping
export const languageNames: Record<string, string> = {
  'kn': 'Kannada',
  'hi': 'Hindi',
  'ta': 'Tamil',
  'te': 'Telugu',
  'ml': 'Malayalam',
  'mr': 'Marathi',
  'bn': 'Bengali',
  'gu': 'Gujarati',
  'pa': 'Punjabi',
  'or': 'Odia',
  'en': 'English',
  'unknown': 'Detecting...',
};
