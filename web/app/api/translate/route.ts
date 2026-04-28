/**
 * Server-side proxy to Sarvam AI translate.
 * Keeps SARVAM_API_KEY off the browser.
 */

interface TranslateRequest {
  text: string;
  sourceLanguage?: string; // e.g. "kn-IN"
  targetLanguage?: string; // e.g. "en-IN"
}

export async function POST(req: Request) {
  const { text, sourceLanguage = "kn-IN", targetLanguage = "en-IN" } =
    (await req.json()) as TranslateRequest;

  if (!text?.trim()) {
    return Response.json({ translatedText: "", sourceLanguage });
  }

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    // Graceful no-op: pass the text through. Useful when no key is set yet.
    return Response.json({
      translatedText: text,
      sourceLanguage,
      passthrough: true,
      warning: "SARVAM_API_KEY not configured — passing text through untranslated",
    });
  }

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
      const errText = await res.text();
      return Response.json(
        { error: `Sarvam HTTP ${res.status}: ${errText}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      translated_text?: string;
      source_language_code?: string;
    };

    return Response.json({
      translatedText: data.translated_text ?? "",
      sourceLanguage: data.source_language_code ?? sourceLanguage,
    });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
