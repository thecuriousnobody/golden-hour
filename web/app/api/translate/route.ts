/**
 * Server-side proxy to Sarvam AI translate.
 *
 * Two callers:
 *  1. The legacy STT→EN path (sourceLanguage="kn-IN", targetLanguage="en-IN").
 *  2. The new bilingual-display path: render the agent's English reply in
 *     the caller's detected language so a non-English-literate bystander
 *     (or a nearby helper) can read the instructions instead of having to
 *     catch every word of TTS audio.
 *
 * Chunks at 800 chars before calling Sarvam. The TTS endpoint learned the
 * hard way (2026-05-19 Lounge prep) that Sarvam /translate silently drops
 * input beyond ~1000 chars, falling back to the source language. Long
 * triage summaries hit that wall. Chunking by sentence avoids it.
 *
 * Accepts JSON:
 *   { text: string,
 *     lang?: string,           // shorthand for targetLanguage
 *     sourceLanguage?: string,
 *     targetLanguage?: string }
 * Returns:
 *   { translatedText: string, lang: string, warnings?: string[] }
 */

import { corsHeaders, preflightResponse } from "@/lib/cors";

export const maxDuration = 30;

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

const MAX_CHARS_PER_CHUNK = 800;

function chunkText(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  if (cleaned.length <= MAX_CHARS_PER_CHUNK) return [cleaned];
  // Split on sentence-ish boundaries (Latin + Devanagari danda).
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
        // Greedy word-pack a too-long sentence.
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
  // If caller already passed a full code like "kn-IN" we just return it.
  if (lang.includes("-")) return lang;
  return map[base] ?? "en-IN";
}

interface TranslateRequest {
  text?: string;
  lang?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export async function POST(req: Request) {
  const cors = corsHeaders(req);

  let body: TranslateRequest;
  try {
    body = (await req.json()) as TranslateRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
  }

  const text = (body.text ?? "").trim();
  // The new caller passes `lang` and assumes English source.
  // The legacy caller passes sourceLanguage / targetLanguage explicitly.
  const sourceLanguage = body.sourceLanguage ?? "en-IN";
  const targetLanguage = normalizeLang(
    body.targetLanguage ?? body.lang ?? "en-IN"
  );

  if (!text) {
    return Response.json(
      { translatedText: "", lang: targetLanguage },
      { headers: cors }
    );
  }

  // Same-language: nothing to do.
  if (sourceLanguage === targetLanguage) {
    return Response.json(
      { translatedText: text, lang: targetLanguage },
      { headers: cors }
    );
  }

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    // Graceful pass-through — caller can still render the English text.
    return Response.json(
      {
        translatedText: text,
        lang: targetLanguage,
        passthrough: true,
        warning: "SARVAM_API_KEY not configured — passing text through",
      },
      { headers: cors }
    );
  }

  const chunks = chunkText(text);
  const translated: string[] = [];
  const issues: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const res = await fetch("https://api.sarvam.ai/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": apiKey,
        },
        body: JSON.stringify({
          input: chunk,
          source_language_code: sourceLanguage,
          target_language_code: targetLanguage,
          mode: "formal",
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        issues.push(`chunk#${i}: HTTP ${res.status}`);
        console.warn(`[translate] chunk ${i + 1}/${chunks.length} failed`, {
          source: sourceLanguage,
          target: targetLanguage,
          chunkLen: chunk.length,
          status: res.status,
          body: errBody.slice(0, 200),
        });
        // Fall through with the source chunk so partial output is still useful.
        translated.push(chunk);
        continue;
      }
      const data = (await res.json()) as { translated_text?: string };
      const t = (data.translated_text ?? "").trim();
      translated.push(t || chunk);
    } catch (err) {
      issues.push(`chunk#${i}: ${(err as Error).message}`);
      translated.push(chunk);
    }
  }

  console.log(`[translate] ok`, {
    source: sourceLanguage,
    target: targetLanguage,
    chunks: chunks.length,
    issues: issues.length,
  });

  return Response.json(
    {
      translatedText: translated.join(" "),
      lang: targetLanguage,
      // Legacy field — keep the old caller happy.
      sourceLanguage,
      ...(issues.length ? { warnings: issues } : {}),
    },
    { headers: cors }
  );
}
