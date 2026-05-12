/**
 * Builds a fully-qualified API URL using NEXT_PUBLIC_API_BASE_URL when set,
 * otherwise returns the relative path so the browser dev server keeps working.
 *
 * The Capacitor APK build sets NEXT_PUBLIC_API_BASE_URL=https://golden-hour-fawn.vercel.app
 * at build time, so the packaged app calls the live Vercel backend. In the
 * regular web build the var is unset and fetches stay relative.
 */
export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!base) return path;
  // Strip a trailing slash on base and a leading slash on path to avoid `//`
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}
