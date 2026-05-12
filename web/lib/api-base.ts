/**
 * Builds a fully-qualified API URL.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_API_BASE_URL (set at build time) — escape hatch for
 *      pointing the app at a different backend (staging, ngrok, etc.)
 *   2. Capacitor native runtime — when running inside the Android/iOS
 *      shell, fall back to the hardcoded production URL because relative
 *      paths resolve to `https://localhost/...` which has no backend.
 *   3. Otherwise return the relative path (browser dev + Vercel web build)
 *
 * Doing the native check at runtime instead of relying on build-time env
 * inlining means we don't have to fight Next.js / Turbopack about when
 * NEXT_PUBLIC_* values get baked into the static export.
 */

import { Capacitor } from "@capacitor/core";

const NATIVE_API_BASE = "https://golden-hour-fawn.vercel.app";

export function apiUrl(path: string): string {
  const envBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  let base = envBase;

  if (!base) {
    try {
      if (Capacitor.isNativePlatform()) base = NATIVE_API_BASE;
    } catch {
      // Capacitor not available — leave base unset, fall through to relative.
    }
  }

  if (!base) {
    return path.startsWith("/") ? path : `/${path}`;
  }
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}
