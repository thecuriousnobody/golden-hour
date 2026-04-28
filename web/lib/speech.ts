/**
 * Speech capture for Golden Hour.
 *
 * Two modes:
 *   1. Browser-native Web Speech API (free, live transcript). Best for English
 *      and a handful of Indian languages Chrome supports natively.
 *   2. Audio upload → /api/speech (Sarvam STT-translate, auto-detects Indian
 *      languages, returns English in one call).
 *
 * The page picks mode 1 by default for the Peoria demo (en-US).
 */

export const LANGUAGE_NAMES: Record<string, string> = {
  "en-US": "English",
  "en-IN": "English (India)",
  "kn-IN": "Kannada",
  "hi-IN": "Hindi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "bn-IN": "Bengali",
  "gu-IN": "Gujarati",
  "pa-IN": "Punjabi",
  kn: "Kannada",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  ml: "Malayalam",
  mr: "Marathi",
  bn: "Bengali",
  gu: "Gujarati",
  pa: "Punjabi",
  en: "English",
  unknown: "Detecting…",
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

// ===========================================================================
// Mode 1: Web Speech API (browser-native, live transcript)
// ===========================================================================

export interface LiveTranscript {
  transcript: string;
  isFinal: boolean;
}

export interface LiveRecognitionHandle {
  stop: () => void;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

export function startLiveRecognition(
  language: string,
  onUpdate: (t: LiveTranscript) => void,
  onError: (msg: string) => void
): LiveRecognitionHandle | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => unknown;
    webkitSpeechRecognition?: new () => unknown;
  };
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) {
    onError("Voice recognition not supported. Use Chrome or Edge.");
    return null;
  }

  const rec = new SR() as unknown as {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start: () => void;
    stop: () => void;
    onresult: (e: unknown) => void;
    onerror: (e: unknown) => void;
  };

  rec.lang = language;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (event: unknown) => {
    const results = (event as {
      results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
    }).results;
    let finalText = "";
    let interimText = "";
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interimText += r[0].transcript;
    }
    onUpdate({
      transcript: (finalText + interimText).trim(),
      isFinal: !!finalText && !interimText,
    });
  };

  rec.onerror = (event: unknown) => {
    const err = (event as { error?: string }).error ?? "unknown";
    onError(`Voice error: ${err}`);
  };

  rec.start();

  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        // already stopped
      }
    },
  };
}

// ===========================================================================
// Mode 2: MediaRecorder + Sarvam upload (Indian languages, auto-detect)
// ===========================================================================

export interface RecorderHandle {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

export function isRecordingSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(navigator.mediaDevices && typeof MediaRecorder !== "undefined");
}

export async function startRecording(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();
  const cleanup = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          cleanup();
          resolve(new Blob(chunks, { type: mime || "audio/webm" }));
        };
        recorder.stop();
      }),
    cancel: () => {
      try {
        recorder.stop();
      } catch {
        // already stopped
      }
      cleanup();
    },
  };
}

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

export interface TranscribeResult {
  transcript: string;
  englishText: string;
  detectedLanguage: string;
  error?: string;
  passthrough?: boolean;
}

export async function transcribeAndTranslate(audio: Blob): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("file", audio, "audio.webm");
  try {
    const res = await fetch("/api/speech", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      return {
        transcript: "",
        englishText: "",
        detectedLanguage: "unknown",
        error: data.error ?? `HTTP ${res.status}`,
      };
    }
    return {
      transcript: data.transcript ?? "",
      englishText: data.englishText ?? data.transcript ?? "",
      detectedLanguage: data.detectedLanguage ?? "unknown",
      passthrough: data.passthrough,
    };
  } catch (err) {
    return {
      transcript: "",
      englishText: "",
      detectedLanguage: "unknown",
      error: (err as Error).message,
    };
  }
}
