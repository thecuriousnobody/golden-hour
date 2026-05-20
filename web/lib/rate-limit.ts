/**
 * Best-effort, in-memory IP rate limiter + body size cap for public API
 * routes. The goal is NOT bulletproof DoS protection — it's "stop casual
 * curl abuse from burning the Anthropic/Sarvam/Twilio bill."
 *
 * Caveats:
 *  - Vercel serverless invocations don't share memory across regions or
 *    cold starts, so the limit is per-instance, not global. An attacker
 *    parallelizing across regions can still get more than `max` through.
 *    Acceptable for pre-launch.
 *  - When we move to a paying user base, swap this for Vercel KV or
 *    Upstash Redis with a sliding-window algorithm.
 */
import { corsHeaders } from "@/lib/cors";

const WINDOW_MS = 60_000; // 1 minute
// Each bucket holds an array of request timestamps (ms). Older entries are
// pruned on each access — no separate sweep needed.
const buckets = new Map<string, number[]>();

/**
 * Best-effort IP extraction. Vercel sets x-forwarded-for and x-real-ip;
 * direct callers won't have either, in which case we lump them under
 * "unknown" and they share a bucket (which makes the limit stricter for
 * non-Vercel-proxied traffic — fine).
 */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export interface RateLimitOpts {
  /** Logical endpoint name — keeps buckets per-route so a burst on speech
   *  doesn't lock dispatch. */
  key: string;
  /** Max requests per IP per WINDOW_MS. */
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
  remaining: number;
}

export function rateLimit(req: Request, opts: RateLimitOpts): RateLimitResult {
  const ip = clientIp(req);
  const bucketKey = `${opts.key}:${ip}`;
  const now = Date.now();
  const existing = buckets.get(bucketKey) ?? [];
  const fresh = existing.filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= opts.max) {
    const oldest = fresh[0];
    const retryAfterSec = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
    buckets.set(bucketKey, fresh);
    return { ok: false, retryAfterSec, remaining: 0 };
  }
  fresh.push(now);
  buckets.set(bucketKey, fresh);

  // Crude memory cap: if the map explodes, drop the oldest half. Prevents a
  // long-lived process from leaking memory under sustained abuse.
  if (buckets.size > 5000) {
    const cutoff = Math.floor(buckets.size / 2);
    let dropped = 0;
    for (const k of buckets.keys()) {
      if (dropped >= cutoff) break;
      buckets.delete(k);
      dropped++;
    }
  }

  return { ok: true, retryAfterSec: 0, remaining: Math.max(0, opts.max - fresh.length) };
}

/**
 * Build a 429 JSON response with proper Retry-After + CORS headers.
 * Returning a structured body lets the UI render a friendly message.
 */
export function tooManyRequestsResponse(
  req: Request,
  result: RateLimitResult
): Response {
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded. Slow down for a moment.",
      retryAfterSec: result.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSec),
        ...corsHeaders(req),
      },
    }
  );
}

/**
 * Check the declared Content-Length against a max-bytes cap. We trust the
 * header here — a hostile client could lie, but the runtime will refuse to
 * buffer a body larger than its own limits regardless, and the goal is to
 * reject obvious abuse early before parsing.
 */
export interface BodySizeCheck {
  ok: boolean;
  size: number;
}

export function checkBodySize(req: Request, maxBytes: number): BodySizeCheck {
  const len = req.headers.get("content-length");
  if (!len) return { ok: true, size: -1 }; // unknown — proceed
  const size = parseInt(len, 10);
  if (!Number.isFinite(size)) return { ok: true, size: -1 };
  return { ok: size <= maxBytes, size };
}

export function payloadTooLargeResponse(req: Request, size: number, max: number): Response {
  return new Response(
    JSON.stringify({
      error: `Request body too large (${size} bytes, max ${max}).`,
    }),
    {
      status: 413,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(req),
      },
    }
  );
}
