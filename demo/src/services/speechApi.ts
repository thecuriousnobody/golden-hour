/**
 * Google Web Speech API - Free, built into Chrome
 * Supports Indian languages: Hindi, Kannada, Tamil, Telugu, etc.
 *
 * Sarvam AI Translate API - For translating Indian languages to English
 */

export interface TranscriptionResult {
  transcript: string;
  languageDetected: string;
  confidence: number;
}

export interface TranslationResult {
  translatedText: string;
  sourceLanguage: string;
}

// Sarvam Translate API
const SARVAM_TRANSLATE_URL = 'https://api.sarvam.ai/translate';

export async function translateToEnglish(
  text: string,
  sourceLanguage: string = 'kn-IN'
): Promise<TranslationResult> {
  const apiKey = import.meta.env.VITE_SARVAM_API_KEY;

  if (!apiKey) {
    throw new Error('VITE_SARVAM_API_KEY not configured');
  }

  if (!text.trim()) {
    return { translatedText: '', sourceLanguage };
  }

  const response = await fetch(SARVAM_TRANSLATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': apiKey,
    },
    body: JSON.stringify({
      input: text,
      source_language_code: sourceLanguage,
      target_language_code: 'en-IN',
      mode: 'formal',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sarvam API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    translatedText: data.translated_text || '',
    sourceLanguage: data.source_language_code || sourceLanguage,
  };
}

// Translate English text back to an Indian language (e.g., Kannada)
export async function translateFromEnglish(
  text: string,
  targetLanguage: string = 'kn-IN'
): Promise<TranslationResult> {
  const apiKey = import.meta.env.VITE_SARVAM_API_KEY;

  if (!apiKey) {
    throw new Error('VITE_SARVAM_API_KEY not configured');
  }

  if (!text.trim()) {
    return { translatedText: '', sourceLanguage: 'en-IN' };
  }

  const response = await fetch(SARVAM_TRANSLATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': apiKey,
    },
    body: JSON.stringify({
      input: text,
      source_language_code: 'en-IN',
      target_language_code: targetLanguage,
      mode: 'formal',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sarvam API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    translatedText: data.translated_text || '',
    sourceLanguage: 'en-IN',
  };
}

// Language codes for Indian languages
export const INDIAN_LANGUAGES = {
  'kn-IN': 'Kannada',
  'hi-IN': 'Hindi',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'pa-IN': 'Punjabi',
  'en-IN': 'English (India)',
};

export const languageNames: Record<string, string> = {
  'kn-IN': 'Kannada',
  'kn': 'Kannada',
  'hi-IN': 'Hindi',
  'hi': 'Hindi',
  'ta-IN': 'Tamil',
  'ta': 'Tamil',
  'te-IN': 'Telugu',
  'te': 'Telugu',
  'ml-IN': 'Malayalam',
  'ml': 'Malayalam',
  'en-IN': 'English (India)',
  'en': 'English',
  'unknown': 'Detecting...',
};

// Check if Web Speech API is available
export function isSpeechRecognitionSupported(): boolean {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

// Create speech recognition instance
export function createSpeechRecognition(
  language: string = 'kn-IN',
  onResult: (result: TranscriptionResult) => void,
  onError: (error: string) => void
): SpeechRecognition | null {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    onError('Speech recognition not supported in this browser. Please use Chrome.');
    return null;
  }

  const recognition = new SpeechRecognition();

  // Configure for Indian languages
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let finalTranscript = '';
    let interimTranscript = '';
    let confidence = 0;

    // Accumulate ALL results (not just from resultIndex) so previous
    // finalized segments are never lost when new speech arrives.
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
        confidence = result[0].confidence || 0.9;
      } else {
        interimTranscript += result[0].transcript;
      }
    }

    onResult({
      transcript: finalTranscript + interimTranscript,
      languageDetected: language,
      confidence: confidence || 0.85,
    });
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    console.error('Speech recognition error:', event.error);
    onError(`Speech error: ${event.error}`);
  };

  return recognition;
}
