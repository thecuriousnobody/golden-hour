import { createDispatcherStream } from "@/lib/agents/dispatcher";
import { convertToModelMessages } from "ai";
import type { UIMessage, ModelMessage } from "ai";
import type { CallerContext } from "@/lib/types";
import { corsHeaders, preflightResponse } from "@/lib/cors";

export const maxDuration = 120;

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

/** Strip _-prefixed keys (rendering payloads) from a JSON object. */
function stripUnderscoreKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

/**
 * Drop _cards / _quickReplies from prior tool results before re-feeding history.
 * The agent already has the lightweight summary it needs; rendering payloads
 * waste 10–25K tokens per turn if left in.
 */
function stripRenderingData(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "tool") return msg;
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type !== "tool-result") return part;
        const out = part.output;
        if (!out) return part;

        if (
          out.type === "json" &&
          typeof out.value === "object" &&
          out.value !== null &&
          !Array.isArray(out.value)
        ) {
          // AI SDK v6 types out.value as a recursive JSONValue; cast is safe
          // because we only remove keys, never introduce non-JSON values.
          const stripped = stripUnderscoreKeys(out.value as Record<string, unknown>);
          return {
            ...part,
            output: { ...out, value: stripped as typeof out.value },
          };
        }

        if (out.type === "text") {
          try {
            const parsed = JSON.parse(out.value);
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
              return {
                ...part,
                output: { ...out, value: JSON.stringify(stripUnderscoreKeys(parsed)) },
              };
            }
          } catch {
            // not JSON — leave it
          }
        }

        return part;
      }),
    } as typeof msg;
  });
}

export async function POST(req: Request) {
  try {
    const { messages, caller } = (await req.json()) as {
      messages: UIMessage[];
      caller?: Partial<CallerContext>;
    };

    const fullCaller: CallerContext = {
      lat: caller?.lat ?? Number(process.env.DEFAULT_CALLER_LAT ?? 12.9716),
      lng: caller?.lng ?? Number(process.env.DEFAULT_CALLER_LNG ?? 77.5946),
      language: caller?.language ?? "en",
      name: caller?.name,
      phone: caller?.phone,
      familyContacts: caller?.familyContacts ?? [],
    };

    // Keep last 10 messages for context (system prompt is already rich)
    const recent = messages.slice(-10);
    const modelMessages = stripRenderingData(await convertToModelMessages(recent));

    const result = await createDispatcherStream(modelMessages, fullCaller);
    return result.toUIMessageStreamResponse({ headers: corsHeaders(req) });
  } catch (err) {
    console.error("[/api/dispatch] error:", err);
    return new Response(
      JSON.stringify({ error: "Dispatcher unavailable. Try again." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      }
    );
  }
}
