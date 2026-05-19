/**
 * Text-to-speech for Golden Hour agent replies.
 *
 * Strategy:
 *   - English  → browser SpeechSynthesis API (free, instant, no network).
 *   - Indian   → /api/tts proxy → Sarvam bulbul:v2 → base64 WAV chunks.
 *
 * Critical for the demo: a bystander doing CPR can't read. They need to
 * *hear* the agent's first-aid steps, not parse a wall of text.
 */

import { apiUrl } from "@/lib/api-base";

let currentAudio: HTMLAudioElement | null = null;
let cancelled = false;

export function stopSpeaking() {
  cancelled = true;
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = "";
    } catch {
      // ignore
    }
    currentAudio = null;
  }
}

/**
 * Strip markdown formatting before speaking. Without this, browser TTS will
 * literally pronounce "asterisk asterisk" for **bold** text, and Sarvam's
 * preprocessing on Indian languages doesn't know our markdown either.
 */
export function stripMarkdownForSpeech(text: string): string {
  return text
    // Remove code fences and inline code
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    // Bold / italic / strike
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    // Links → just the text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Headings / blockquotes / list bullets at line start
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // Tables: drop pipe characters
    .replace(/\|/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

function isEnglishCode(lang: string): boolean {
  const base = lang.toLowerCase().split("-")[0];
  return base === "en" || base === "";
}

function browserSpeak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || "en-US";
    u.rate = 1.0;
    u.pitch = 1.0;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

function playBase64Wav(base64: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    currentAudio = audio;
    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.play().catch(() => resolve());
  });
}

async function sarvamSpeak(text: string, lang: string): Promise<void> {
  try {
    const res = await fetch(apiUrl("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { audios?: string[] };
    if (!data.audios) return;
    for (const b64 of data.audios) {
      if (cancelled) return;
      await playBase64Wav(b64);
    }
  } catch {
    // best-effort; never throw from TTS
  }
}

/**
 * Speak `text` in `lang`. Returns when audio finishes (or immediately if
 * stopSpeaking() interrupts). Safe to call repeatedly — earlier playback is
 * cancelled.
 */
export async function speak(text: string, lang: string): Promise<void> {
  const cleaned = stripMarkdownForSpeech(text);
  if (!cleaned) return;

  // New utterance cancels any prior one.
  stopSpeaking();
  cancelled = false;

  if (isEnglishCode(lang)) {
    await browserSpeak(cleaned, lang || "en-US");
  } else {
    await sarvamSpeak(cleaned, lang);
  }
}
