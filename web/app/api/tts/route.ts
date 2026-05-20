/**
 * Server-side proxy to Sarvam AI text-to-speech.
 *
 * Used to play the agent's reply *back* to the caller in the same Indian
 * language they spoke. The English path uses the browser's built-in
 * SpeechSynthesis API and never hits this endpoint.
 *
 * Accepts JSON: { text: string, lang: string }   // lang e.g. "kn-IN"
 * Returns:      { audios: string[] }              // base64 WAV chunks
 */

import { corsHeaders, preflightResponse } from "@/lib/cors";
import {
  rateLimit,
  tooManyRequestsResponse,
  checkBodySize,
  payloadTooLargeResponse,
} from "@/lib/rate-limit";

export const maxDuration = 30;

// TTS is fired once per assistant message when the speaker is on.
// 30/min is plenty of headroom for a normal conversation.
const RATE_MAX_PER_MIN = 30;
const MAX_BODY_BYTES = 32 * 1024;

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

// Sarvam translate's per-call limit is ~1000 chars; TTS's per-input limit is
// ~500. We chunk at 300 to leave headroom for the translated text potentially
// being longer than the English source (Indic scripts use ~1.2-1.5x bytes per
// concept). We chunk by sentence so we never truncate mid-word.
const MAX_CHARS_PER_CHUNK = 300;

function chunkText(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  if (cleaned.length <= MAX_CHARS_PER_CHUNK) return [cleaned];

  // Split on sentence-ish boundaries; if a "sentence" is still too long,
  // fall back to greedy word-packing.
  const sentences = cleaned.split(/(?<=[.!?।])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + " " + s).trim().length <= MAX_CHARS_PER_CHUNK) {
      current = (current + " " + s).trim();
    } else {
      if (current) chunks.push(current);
      if (s.length <= MAX_CHARS_PER_CHUNK) {
        current = s;
      } else {
        // Greedy word pack a too-long sentence.
        const words = s.split(/\s+/);
        let buf = "";
        for (const w of words) {
          if ((buf + " " + w).trim().length <= MAX_CHARS_PER_CHUNK) {
            buf = (buf + " " + w).trim();
          } else {
            if (buf) chunks.push(buf);
            buf = w;
          }
        }
        current = buf;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Map our incoming lang codes ("kn", "hi", "kn-IN" …) to Sarvam's required form.
function normalizeLang(lang: string): string {
  const base = lang.toLowerCase().split("-")[0];
  const map: Record<string, string> = {
    kn: "kn-IN",
    hi: "hi-IN",
    ta: "ta-IN",
    te: "te-IN",
    ml: "ml-IN",
    mr: "mr-IN",
    bn: "bn-IN",
    gu: "gu-IN",
    pa: "pa-IN",
    en: "en-IN",
  };
  return map[base] ?? "en-IN";
}

async function translateChunk(
  apiKey: string,
  text: string,
  target_language_code: string
): Promise<{ text: string; ok: boolean; reason?: string }> {
  if (target_language_code === "en-IN" || target_language_code === "en-US") {
    return { text, ok: true };
  }
  try {
    const res = await fetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text,
        source_language_code: "en-IN",
        target_language_code,
        mode: "formal",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { text, ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { translated_text?: string };
    const translated = (data.translated_text ?? "").trim();
    if (!translated) return { text, ok: false, reason: "empty translated_text" };
    return { text: translated, ok: true };
  } catch (err) {
    return { text, ok: false, reason: (err as Error).message };
  }
}

async function synthesizeChunk(
  apiKey: string,
  text: string,
  target_language_code: string
): Promise<{ audios: string[]; ok: boolean; reason?: string }> {
  try {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code,
        speaker: "anushka",
        model: "bulbul:v2",
        pitch: 0,
        pace: 1.0,
        loudness: 1.2,
        enable_preprocessing: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { audios: [], ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { audios?: string[] };
    return { audios: data.audios ?? [], ok: true };
  } catch (err) {
    return { audios: [], ok: false, reason: (err as Error).message };
  }
}

export async function POST(req: Request) {
  const size = checkBodySize(req, MAX_BODY_BYTES);
  if (!size.ok) return payloadTooLargeResponse(req, size.size, MAX_BODY_BYTES);

  const rl = rateLimit(req, { key: "tts", max: RATE_MAX_PER_MIN });
  if (!rl.ok) return tooManyRequestsResponse(req, rl);

  const cors = corsHeaders(req);
  const apiKey = process.env.SARVAM_API_KEY;

  let body: { text?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
  }

  const text = (body.text ?? "").trim();
  const lang = body.lang ?? "en";

  if (!text) {
    return Response.json({ error: "Missing text" }, { status: 400, headers: cors });
  }

  if (!apiKey) {
    return Response.json(
      { error: "SARVAM_API_KEY not configured", audios: [] },
      { status: 503, headers: cors }
    );
  }

  const target_language_code = normalizeLang(lang);

  // Agent always replies in English. Sarvam TTS does NOT translate — it
  // expects text in the target script. So for each chunk: translate first,
  // then synthesize. Chunking BEFORE translation keeps every translate call
  // small (avoids the ~1000-char limit that silently dropped the third-turn
  // triage summary in the 2026-05-19 Lounge prep, which fell through to the
  // English-passthrough fallback and gave the audience English audio on
  // what should have been the Kannada money turn).
  const chunks = chunkText(text);
  const audios: string[] = [];
  const issues: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const t = await translateChunk(apiKey, chunk, target_language_code);
    if (!t.ok) {
      issues.push(`translate#${i}: ${t.reason}`);
      console.warn(`[tts] translate chunk ${i + 1}/${chunks.length} failed`, {
        target: target_language_code,
        chunkLen: chunk.length,
        reason: t.reason,
      });
    }
    const s = await synthesizeChunk(apiKey, t.text, target_language_code);
    if (!s.ok) {
      issues.push(`tts#${i}: ${s.reason}`);
      console.warn(`[tts] synth chunk ${i + 1}/${chunks.length} failed`, {
        target: target_language_code,
        chunkLen: t.text.length,
        reason: s.reason,
      });
      continue;
    }
    audios.push(...s.audios);
  }

  console.log(`[tts] ok`, {
    target: target_language_code,
    chunks: chunks.length,
    audios: audios.length,
    issues: issues.length,
  });

  return Response.json(
    { audios, ...(issues.length ? { warnings: issues } : {}) },
    { headers: cors }
  );
}
