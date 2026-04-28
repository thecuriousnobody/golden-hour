/**
 * Browser geolocation wrapper.
 * Falls back to Peoria, IL (~40.6936, -89.5890) if permission denied or unsupported.
 */

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

export function requestGeolocation(timeoutMs = 8000): Promise<GeoFix> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(PEORIA_FALLBACK);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(PEORIA_FALLBACK);
    }, timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
          source: "browser",
          label: "Your current location",
        });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(PEORIA_FALLBACK);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}
