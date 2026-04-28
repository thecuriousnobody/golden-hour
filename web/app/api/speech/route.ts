/**
 * Server-side proxy to Sarvam AI speech-to-text-translate.
 * Auto-detects source Indian language and returns English translation in one call.
 *
 * Accepts multipart FormData with:
 *   - file: audio blob (webm/ogg/wav)
 * Returns: { transcript, detectedLanguage, englishText }
 */

export const maxDuration = 60;

function mimeToExt(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

export async function POST(req: Request) {
  const apiKey = process.env.SARVAM_API_KEY;

  const form = await req.formData();
  const file = form.get("file");

  if (!file || !(file instanceof Blob)) {
    return Response.json({ error: "Missing audio file" }, { status: 400 });
  }

  if (!apiKey) {
    return Response.json({
      transcript: "",
      detectedLanguage: "unknown",
      englishText: "",
      passthrough: true,
      warning: "SARVAM_API_KEY not set — cannot auto-detect. Type instead.",
    });
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
      return Response.json(
        { error: `Sarvam STT HTTP ${res.status}: ${errText}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      transcript?: string;
      language_code?: string;
      diarized_transcript?: unknown;
    };

    return Response.json({
      transcript: data.transcript ?? "",
      englishText: data.transcript ?? "",
      detectedLanguage: data.language_code ?? "unknown",
    });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
