/**
 * CORS support for the Android Capacitor app.
 *
 * The packaged APK runs the bundled UI from `https://localhost` (Capacitor's
 * default `androidScheme`). Requests it makes to `/api/dispatch` and
 * `/api/speech` are cross-origin from Vercel's perspective. Without these
 * headers, the WebView refuses to read the response.
 *
 * The allowlist is intentionally small. We do NOT use `*` — any origin
 * outside the list gets no header, which is the safest default.
 */

const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
  "http://localhost:4005",
  // Add production-web origins here if/when we deploy the UI to a subdomain
  // (right now the UI is bundled into the APK, not hosted standalone).
]);

/**
 * Build the CORS headers for a given request. Echoes the Origin header back
 * only when it's in the allowlist; otherwise returns an empty object so the
 * browser blocks the response on its own.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    // Still set Vary so caches don't serve a stale CORS response to a
    // different origin from this request.
    return { Vary: "Origin" };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Standard 204 preflight response. */
export function preflightResponse(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
