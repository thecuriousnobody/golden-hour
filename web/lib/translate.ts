/**
 * Client-side helper for the /api/translate proxy.
 *
 * Used to render the agent's English reply in the caller's detected
 * language alongside the English original, so a bystander who reads the
 * caller's language (but not English) can follow the on-screen steps
 * instead of having to catch every word of TTS audio.
 */

import { apiUrl } from "@/lib/api-base";

export interface TranslateResult {
  translatedText: string;
  lang: string;
  /** Set when SARVAM_API_KEY isn't configured; text is passed through. */
  passthrough?: boolean;
  /** Per-chunk warnings (rare, partial failures). */
  warnings?: string[];
  error?: string;
}

/**
 * Translate `text` (English) into `lang`. Returns the translation, or the
 * original text if the language is English / Sarvam is unreachable.
 * Never throws — TTS-like best-effort.
 */
export async function translateForDisplay(
  text: string,
  lang: string
): Promise<TranslateResult> {
  const trimmed = text.trim();
  if (!trimmed) return { translatedText: "", lang };
  const base = lang.toLowerCase().split("-")[0];
  if (base === "en" || base === "") {
    return { translatedText: trimmed, lang };
  }

  try {
    const res = await fetch(apiUrl("/api/translate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed, lang }),
    });
    const data = (await res.json()) as TranslateResult;
    if (!res.ok) {
      return {
        translatedText: trimmed,
        lang,
        error: data.error ?? `HTTP ${res.status}`,
      };
    }
    return data;
  } catch (err) {
    return {
      translatedText: trimmed,
      lang,
      error: (err as Error).message,
    };
  }
}
