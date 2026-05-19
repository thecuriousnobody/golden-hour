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

export const maxDuration = 30;

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

// Sarvam accepts up to ~500 chars per input. We chunk by sentence so we never
// truncate mid-word. The Sarvam call returns one audio per input in order.
const MAX_CHARS_PER_CHUNK = 450;

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

export async function POST(req: Request) {
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
  const inputs = chunkText(text);

  try {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs,
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
      const errText = await res.text();
      return Response.json(
        { error: `Sarvam TTS HTTP ${res.status}: ${errText.slice(0, 300)}` },
        { status: 502, headers: cors }
      );
    }

    const data = (await res.json()) as { audios?: string[] };
    return Response.json({ audios: data.audios ?? [] }, { headers: cors });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: cors }
    );
  }
}
