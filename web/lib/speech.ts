/**
 * Audio capture + Sarvam speech-to-text-translate (auto-detects Indian language).
 *
 * Flow: record via MediaRecorder → POST blob to /api/speech → get English text back.
 * No language selection — Sarvam's saaras model auto-detects.
 */

export const LANGUAGE_NAMES: Record<string, string> = {
  "kn-IN": "Kannada",
  "hi-IN": "Hindi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "bn-IN": "Bengali",
  "gu-IN": "Gujarati",
  "pa-IN": "Punjabi",
  "en-IN": "English",
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

export interface RecorderHandle {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

export function isRecordingSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(navigator.mediaDevices && typeof MediaRecorder !== "undefined");
}

/**
 * Start capturing microphone audio. Returns a handle you can stop() to get a Blob.
 * We prefer opus/webm which Sarvam accepts.
 */
export async function startRecording(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const mime = pickMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.start();

  const cleanup = () => {
    stream.getTracks().forEach((t) => t.stop());
  };

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

/**
 * Upload audio to /api/speech and get back the English translation
 * plus the auto-detected source language.
 */
export async function transcribeAndTranslate(audio: Blob): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("file", audio, "audio.webm");

  try {
    const res = await fetch("/api/speech", {
      method: "POST",
      body: form,
    });
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
