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
import {
  rateLimit,
  tooManyRequestsResponse,
  checkBodySize,
  payloadTooLargeResponse,
} from "@/lib/rate-limit";

export const maxDuration = 30;

// Translate is called once per assistant message for bilingual display +
// once per chunk by the TTS pipeline. 60/min comfortably covers a chatty
// session and still catches abuse.
const RATE_MAX_PER_MIN = 60;
const MAX_BODY_BYTES = 32 * 1024;

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
  /**
   * When true, preserve block-level markdown structure (headings, list
   * items, blockquotes) by translating line-by-line instead of as a single
   * paragraph. Sarvam's translate doesn't preserve markdown syntax — it
   * returns a flat paragraph — so a bilingual UI loses headings + lists
   * unless we peel each line's marker, translate the prose, then reattach.
   */
  preserveMarkdown?: boolean;
}

/**
 * Split a markdown line into its leading block-level marker (heading hash,
 * list bullet, ordered-list number, blockquote) and the remaining content.
 * The marker is kept verbatim — it doesn't get translated.
 */
function splitMarker(line: string): { prefix: string; content: string } {
  // Match leading whitespace + optional marker. Headings: #..######,
  // list bullets: - * +, ordered: \d+. or \d+), blockquote: >.
  const m = line.match(
    /^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+))(.*)$/
  );
  if (m) return { prefix: m[1], content: m[2] };
  return { prefix: "", content: line };
}

/**
 * Strip inline markdown emphasis before translation. We don't try to
 * re-impose **bold** etc. on the translated output — word boundaries
 * change across languages and we'd guess wrong as often as right. The
 * content reads correctly without it; block-level structure is what
 * carries the scannability of a triage list.
 */
function stripInlineEmphasis(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/**
 * Translate a single chunk via Sarvam. Returns the source on failure so the
 * caller can fall back gracefully.
 */
async function translateOne(
  apiKey: string,
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<{ text: string; ok: boolean; reason?: string }> {
  if (!text.trim()) return { text, ok: true };
  try {
    const res = await fetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify({
        input: text,
        source_language_code: sourceLanguage,
        target_language_code: targetLanguage,
        mode: "formal",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { text, ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 160)}` };
    }
    const data = (await res.json()) as { translated_text?: string };
    const t = (data.translated_text ?? "").trim();
    return { text: t || text, ok: !!t };
  } catch (err) {
    return { text, ok: false, reason: (err as Error).message };
  }
}

/**
 * Markdown-aware translation. Processes the input line by line, preserving
 * block-level markers, with a small concurrency cap so a 15-line triage
 * card doesn't fan out to 15 simultaneous Sarvam calls.
 */
async function translateMarkdownStructured(
  apiKey: string,
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<{ text: string; issues: string[] }> {
  const lines = text.split("\n");
  const issues: string[] = [];

  // Build the work list — index + content to translate. Blank lines and
  // marker-only lines pass through untouched.
  type Work = { index: number; prefix: string; content: string };
  const work: Work[] = [];
  const output: string[] = new Array(lines.length).fill("");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      output[i] = line;
      continue;
    }
    const { prefix, content } = splitMarker(line);
    const stripped = stripInlineEmphasis(content);
    if (!stripped.trim()) {
      output[i] = line;
      continue;
    }
    work.push({ index: i, prefix, content: stripped });
  }

  // Simple concurrency-capped worker pool. Sarvam's rate limits are quiet
  // but unfanned 15 simultaneous POSTs is rude.
  const CONCURRENCY = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < work.length) {
      const my = work[cursor++];
      if (!my) return;
      const { text: translated, ok, reason } = await translateOne(
        apiKey,
        my.content,
        sourceLanguage,
        targetLanguage
      );
      if (!ok) {
        issues.push(`line#${my.index}: ${reason}`);
      }
      output[my.index] = my.prefix + translated;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return { text: output.join("\n"), issues };
}

export async function POST(req: Request) {
  const size = checkBodySize(req, MAX_BODY_BYTES);
  if (!size.ok) return payloadTooLargeResponse(req, size.size, MAX_BODY_BYTES);

  const rl = rateLimit(req, { key: "translate", max: RATE_MAX_PER_MIN });
  if (!rl.ok) return tooManyRequestsResponse(req, rl);

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

  // Markdown-aware path — line-by-line, preserves headings + lists. Used
  // by the bilingual on-screen toggle so the Kannada/Hindi rendering keeps
  // the same scannable structure as the English source.
  if (body.preserveMarkdown) {
    const { text: translatedText, issues } = await translateMarkdownStructured(
      apiKey,
      text,
      sourceLanguage,
      targetLanguage
    );
    console.log(`[translate] ok (markdown)`, {
      source: sourceLanguage,
      target: targetLanguage,
      lines: text.split("\n").length,
      issues: issues.length,
    });
    return Response.json(
      {
        translatedText,
        lang: targetLanguage,
        sourceLanguage,
        ...(issues.length ? { warnings: issues } : {}),
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
