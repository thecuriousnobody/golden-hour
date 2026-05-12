/**
 * Platform detection for the Capacitor Android shell.
 *
 * `isNative()` returns true when the page is running inside a Capacitor
 * WebView (Android/iOS app), false in the regular browser. We use this to:
 *   - Skip the Web Speech API path (not available in Android WebView)
 *   - Surface native toasts instead of inline alerts
 *   - Persist demo identity via @capacitor/preferences instead of localStorage
 */

import { Capacitor } from "@capacitor/core";

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function platformName(): "android" | "ios" | "web" {
  try {
    const p = Capacitor.getPlatform();
    if (p === "android" || p === "ios") return p;
    return "web";
  } catch {
    return "web";
  }
}
