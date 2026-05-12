/**
 * Geolocation wrapper.
 *
 * Uses @capacitor/geolocation, which:
 *   - On native (Capacitor Android/iOS): calls the native location API and
 *     handles runtime permission prompts.
 *   - In a regular browser: delegates to navigator.geolocation via Capacitor's
 *     web shim, so localhost / Vercel keep working unchanged.
 *
 * Falls back to Peoria, IL (~40.6936, -89.5890) if permission is denied,
 * the device is unsupported, or the request times out.
 */

import { Geolocation } from "@capacitor/geolocation";

export interface GeoFix {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  source: "browser" | "fallback";
  label: string;
}

export const PEORIA_FALLBACK: GeoFix = {
  lat: 40.6936,
  lng: -89.589,
  source: "fallback",
  label: "Peoria, IL (fallback)",
};

export async function requestGeolocation(timeoutMs = 8000): Promise<GeoFix> {
  // Capacitor's web shim throws if neither the plugin nor navigator.geolocation
  // is available, so race the call against our own timer to guarantee we
  // always resolve (never hang the UI).
  const timer = new Promise<GeoFix>((resolve) => {
    setTimeout(() => resolve(PEORIA_FALLBACK), timeoutMs);
  });

  const locate = (async (): Promise<GeoFix> => {
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 60_000,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy,
        source: "browser",
        label: "Your current location",
      };
    } catch {
      return PEORIA_FALLBACK;
    }
  })();

  return Promise.race([locate, timer]);
}
