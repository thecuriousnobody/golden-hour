/**
 * Server-side proxy to Sarvam AI speech-to-text-translate.
 * Auto-detects source Indian language and returns English translation in one call.
 *
 * Accepts multipart FormData with:
 *   - file: audio blob (webm/ogg/wav)
 * Returns: { transcript, detectedLanguage, englishText }
 */

import { corsHeaders, preflightResponse } from "@/lib/cors";
import {
  rateLimit,
  tooManyRequestsResponse,
  checkBodySize,
  payloadTooLargeResponse,
} from "@/lib/rate-limit";

export const maxDuration = 60;

// 10 MB caps a roughly 5-minute opus blob — well beyond any realistic
// triage turn but still protects against an attacker streaming gigabytes
// to bill us per byte on Sarvam.
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const RATE_MAX_PER_MIN = 20;

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

function mimeToExt(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

export async function POST(req: Request) {
  const size = checkBodySize(req, MAX_BODY_BYTES);
  if (!size.ok) return payloadTooLargeResponse(req, size.size, MAX_BODY_BYTES);

  const rl = rateLimit(req, { key: "speech", max: RATE_MAX_PER_MIN });
  if (!rl.ok) return tooManyRequestsResponse(req, rl);

  const cors = corsHeaders(req);
  const apiKey = process.env.SARVAM_API_KEY;

  const form = await req.formData();
  const file = form.get("file");

  if (!file || !(file instanceof Blob)) {
    return Response.json({ error: "Missing audio file" }, { status: 400, headers: cors });
  }

  if (!apiKey) {
    return Response.json(
      {
        transcript: "",
        detectedLanguage: "unknown",
        englishText: "",
        passthrough: true,
        warning: "SARVAM_API_KEY not set — cannot auto-detect. Type instead.",
      },
      { headers: cors }
    );
  }

  // Sarvam speech-to-text-translate auto-detects source language
  // and returns English translation in one pass.
  // Sarvam only accepts simple mime types (e.g. "audio/webm"), not
  // codec-annotated ones like "audio/webm;codecs=opus" — so we re-wrap.
  const rawType = file.type || "audio/webm";
  const cleanType = rawType.split(";")[0].trim() || "audio/webm";
  const ext = mimeToExt(cleanType);
  const normalized = new Blob([await file.arrayBuffer()], { type: cleanType });

  const sarvamForm = new FormData();
  sarvamForm.append("file", normalized, `audio.${ext}`);
  sarvamForm.append("model", "saaras:v2.5");
  sarvamForm.append("with_diarization", "false");

  try {
    const res = await fetch("https://api.sarvam.ai/speech-to-text-translate", {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
      },
      body: sarvamForm,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[speech] sarvam STT failed", {
        status: res.status,
        contentType: cleanType,
        sizeBytes: normalized.size,
        body: errText.slice(0, 500),
      });
      return Response.json(
        { error: `Sarvam STT HTTP ${res.status}: ${errText.slice(0, 300)}` },
        { status: 502, headers: cors }
      );
    }

    const data = (await res.json()) as {
      transcript?: string;
      language_code?: string;
      diarized_transcript?: unknown;
    };

    return Response.json(
      {
        transcript: data.transcript ?? "",
        englishText: data.transcript ?? "",
        detectedLanguage: data.language_code ?? "unknown",
      },
      { headers: cors }
    );
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: cors }
    );
  }
}
