# Plan — Golden Hour Android v0 (Capacitor Wrapper)

**Date:** 2026-05-02
**Branch:** `feat/android-v0-capacitor` (clean, cut from main)
**Companion to:** `docs/grill/grill-2026-05-02-golden-hour-android-v0.md`
**Audience:** the Claude Code instance that will execute this plan

---

## 1. Pre-flight validation checks (DAY 0)

Do NOT add `@capacitor/*` or touch `web/` source until these pass.

### 1.1 Static-export compatibility of the current `web/` build

**Current state (verified by reading source):**
- `web/next.config.ts` has NO `output: 'export'` flag.
- `web/app/layout.tsx` is server-rendered metadata only — no server components fetching data.
- `web/app/page.tsx` is `"use client"` — a pure client component using `useChat` from `@ai-sdk/react` over `DefaultChatTransport`. The transport is configured with `api: "/api/dispatch"` (line 79) — pure fetch under the hood, fine for static export.
- The only routes are `/`, `/api/dispatch`, `/api/speech`. There are NO dynamic segments, NO `generateStaticParams`, NO `'use server'` actions, NO `runtime = 'edge'` markers.
- `web/lib/speech.ts:197` uses `fetch("/api/speech", ...)` — pure client fetch.

**The hazards under `output: 'export'`:**
1. `app/api/*/route.ts` files are NOT exportable as static. Must either move the routes out, configure the export step to ignore them, or keep API routes only in a separate Vercel deployment.
2. `experimental.serverActions` block in `next.config.ts` is incompatible with `output: 'export'` — must be removed when exporting.

**Validation steps to run before any commit:**

```bash
cd /Users/rajeevkumar/Documents/GIT_Repos/golden-hour/web
# 1. Probe-build with the existing config (sanity)
npm run build 2>&1 | tail -40

# 2. Temporary local-only change (do NOT commit yet) setting
#    `output: 'export'` and removing `experimental.serverActions`, then:
NEXT_PUBLIC_API_BASE_URL=https://golden-hour.vercel.app npm run build 2>&1 | tee /tmp/export-probe.log

# 3. Inspect the result:
ls -la out/                # if it exists, static export wrote files
# Acceptance: out/index.html exists, out/_next/static/* present.
# API routes will be reported as "ignored" in the build log — that's expected/fine.
```

**Expected failure modes and decisions:**
- If `useChat` import surfaces "this hook needs RSC" → drop to remote-WebView fallback (Section 5).
- If build errors on `serverActions` config → remove that block entirely (verified unused).
- If build errors on `convertToModelMessages` / streaming hooks → those only run server-side in `/api/dispatch`; should NOT touch static export.

### 1.2 CORS posture of existing API routes

Verified: zero CORS headers, zero preflight (`OPTIONS`) handler in either route. Both will reject cross-origin browser requests from `https://localhost` / `capacitor://localhost`.

**Required change**: shared CORS helper returning `Access-Control-Allow-Origin` for `capacitor://localhost`, `https://localhost`, and `http://localhost:4005` (dev). Add `OPTIONS` handlers. Both routes need it.

### 1.3 Toolchain smoke tests

```bash
ls ~/Library/Android/sdk/platform-tools/adb     # exists
/opt/homebrew/bin/adb version                    # >= 35
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
/opt/homebrew/bin/adb devices                    # daemon starts cleanly
java -version                                    # must be 17 or 21
npm view @capacitor/cli version
npm view @capacitor/android version
npm view @capacitor/preferences version
npm view @capacitor/geolocation version
```

**Gate:** all four `npm view` queries return a version ≥ 6.x.

---

## 2. Architecture decisions to lock in

### 2.1 Capacitor strategy — static export vs. remote WebView

**Recommendation: ATTEMPT static export first, fall back to remote WebView if the probe fails.**

| Strategy | Pros | Cons |
|---|---|---|
| **Static export** (`output: 'export'` → `out/` → Capacitor `webDir: 'web/out'`) | Works offline for the UI shell. Cold-launch < 1s. APK includes the JS bundle. App feels "real." | Build step gets fiddly: API routes coexist with `output: 'export'` only if the export step is configured to ignore them. |
| **Remote WebView** (Capacitor `server.url` points at `https://golden-hour.vercel.app`) | Zero build pipeline changes to `web/`. Every Vercel deploy ships instantly. | App is useless without internet — even the home screen won't load. Looks like a glorified browser shortcut. |

**Decision: static export.** Code has no SSR/RSC fetches, no dynamic routes, no server actions — already structurally a static SPA with three fetch calls. If `next build` with `output: 'export'` errors anywhere that isn't trivially fixed in under 30 minutes, switch to remote WebView and document.

### 2.2 API base URL handling

**Single env var:** `NEXT_PUBLIC_API_BASE_URL`. Empty string in dev/web; set to `https://golden-hour.vercel.app` in `.env.production.capacitor`.

**Files to modify (only two):**
- `web/app/page.tsx` line 79: `api: "/api/dispatch"` → `api: \`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/dispatch\``
- `web/lib/speech.ts` line 197: `fetch("/api/speech", ...)` → prefixed similarly

Cleaner: helper `lib/api-base.ts` exporting `apiUrl(path: string)`. Both sites import it.

### 2.3 Geolocation — `@capacitor/geolocation`

Capacitor's `Geolocation.getCurrentPosition()` works in BOTH contexts (browser and APK). Same shape as browser API. Permissions via `Geolocation.requestPermissions()` triggers native Android dialog. Replace `navigator.geolocation` calls in `web/lib/geo.ts`. Peoria fallback stays intact.

### 2.4 Storage — Capacitor Preferences fields

**Keys under group `golden-hour`:**
- `callerName`, `callerPhone`, `familyName`, `familyPhone` (strings, E.164 phones)
- `onboardingComplete` (boolean)
- `schemaVersion: 1` (for future migrations)

**Reinstall:** Android wipes Preferences on uninstall. Document as v0 limitation. Do NOT enable Android's auto-backup in v0.

### 2.5 CORS on Vercel API routes

`web/lib/cors.ts` with allowlist:
```ts
const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
  "http://localhost:4005",
  "https://golden-hour.vercel.app",
]);
```

`withCors(req, res)` helper:
- Echoes the origin if allowlisted, else omits.
- Sets `Access-Control-Allow-Methods: POST, OPTIONS` and `Access-Control-Allow-Headers: Content-Type`.
- `Vary: Origin` for cache correctness.

Both API routes: add `OPTIONS` handler returning 204 with headers; wrap existing `POST` responses with CORS headers. For streaming dispatch route, pass headers to `toUIMessageStreamResponse({ headers: corsHeaders })`.

---

## 3. Step-by-step implementation plan

### DAY 1 — Capacitor scaffold + first APK

#### 1.1 Run pre-flight checks
Execute every probe in Section 1. Gates green or fallback to remote-WebView strategy.

#### 1.2 Add CORS to existing API routes
- **What:** Introduce `web/lib/cors.ts`. Wire into both API routes. Add `OPTIONS` handlers.
- **Files:** NEW `web/lib/cors.ts`; MODIFY `web/app/api/dispatch/route.ts`, `web/app/api/speech/route.ts`.
- **Verify:** `curl -X OPTIONS https://golden-hour.vercel.app/api/dispatch -H "Origin: capacitor://localhost" -i` returns 204 with header.

#### 1.3 Introduce `NEXT_PUBLIC_API_BASE_URL`
- **What:** `lib/api-base.ts` helper. Update `page.tsx:79` and `speech.ts:197`. Add `web/.env.example` entry.
- **Files:** NEW `web/lib/api-base.ts`; MODIFY `web/app/page.tsx`, `web/lib/speech.ts`, `web/.env.example`.
- **Verify:** `npm run dev` — dispatch still works at `http://localhost:4005`.

#### 1.4 Convert `web/lib/geo.ts` to `@capacitor/geolocation`
- **What:** Install `@capacitor/geolocation` + `@capacitor/core`. Swap implementation. Same exported signature.
- **Files:** MODIFY `web/package.json`, `web/lib/geo.ts`.
- **Verify:** Browser dev still works; GPS badge populates.

#### 1.5 Scaffold Capacitor at repo root
- **What:**
  ```bash
  # at repo root — verify no existing package.json first
  ls /Users/rajeevkumar/Documents/GIT_Repos/golden-hour
  npm init -y
  npm i -D @capacitor/cli
  npm i @capacitor/core @capacitor/android @capacitor/preferences @capacitor/geolocation
  npx cap init "Golden Hour" "com.distillerylabs.goldenhour" --web-dir web/out
  ```
  If repo root has a conflicting `package.json`, put Capacitor in `/mobile/` with `webDir: '../web/out'`.
- **Files:** NEW `/capacitor.config.ts`, `/package.json` (root), `.gitignore` additions.
- **Verify:** `npx cap doctor` reports healthy config.

#### 1.6 Static-export web build + add Android platform
- **What:**
  ```bash
  cd web
  # Add gated `output: 'export'` in next.config.ts (CAPACITOR_BUILD=1 only)
  CAPACITOR_BUILD=1 npm run build      # produces web/out/
  cd ..
  npx cap add android
  npx cap sync android
  ```
- **Files:** MODIFY `web/next.config.ts`; NEW `android/` directory.
- **Verify:** `web/out/index.html` exists. `android/app/src/main/assets/public/index.html` exists.

#### 1.7 Wire `capacitor.config.ts`
- **What:** `appId`, `appName`, `webDir`, `server.androidScheme: 'https'`, `cleartext: false`.
- **Files:** MODIFY `/capacitor.config.ts`.
- **Verify:** Android Studio gradle sync passes.

#### 1.8 First APK install on Rajeev's phone
- **What:**
  ```bash
  /opt/homebrew/bin/adb devices
  CAPACITOR_BUILD=1 NEXT_PUBLIC_API_BASE_URL=https://golden-hour.vercel.app npm run build --prefix web
  npx cap sync android
  npx cap run android
  ```
- **Verify (Day 1 success gate):** App opens, mic visible, GPS populates after permission grant, sample dispatch works end-to-end against Vercel.

**END DAY 1 — COMMIT 1 + COMMIT 2.**

### DAY 2 — Permissions + Sarvam voice on device

#### 2.1 Just-in-time permissions on first mic tap
- **What:** `ensurePermissions()` called from `GiantMic` first-tap path. Uses `Geolocation.requestPermissions` + `getUserMedia`.
- **Files:** MODIFY `web/app/page.tsx`; optional NEW `web/lib/permissions.ts`.
- **Verify:** Fresh install → first mic tap → two-permission dialog → grant → recording starts.

#### 2.2 Drop Web Speech in wrapped context
- **What:** When `Capacitor.isNativePlatform()` is true, filter `VOICE_MODES` to Sarvam-only.
- **Files:** MODIFY `web/app/page.tsx`, `web/lib/speech.ts`.
- **Verify:** APK voice picker shows only Sarvam options.

#### 2.3 End-to-end voice dispatch on device
- **Verify:** Kannada test phrase → transcript → triage → hospitals → 4 WhatsApp messages on Rajeev's phone.

**END DAY 2 — COMMIT 3.**

### DAY 3 — Onboarding + Preferences

#### 3.1 Build onboarding form
- **What:** Client component, four inputs + Save. Phone normalization. Renders when `onboardingComplete !== true`.
- **Files:** NEW `web/app/onboarding.tsx`, `web/lib/identity.ts`; MODIFY `web/app/page.tsx`.
- **Verify:** Fresh install → onboarding → Save → main screen. Reopen → main screen directly.

#### 3.2 Wire `callerRef` from Preferences
- **What:** Replace `NEXT_PUBLIC_DEMO_*` env defaults with `loadIdentity()`. Keep env vars as browser fallback.
- **Files:** MODIFY `web/app/page.tsx`.
- **Verify:** APK dispatch shows user's actual name in WhatsApp body.

**END DAY 3 — COMMIT 4.**

### DAY 4 — Polish

#### 4.1 Minimal icon
- **What:** 512×512 red-circle-on-white PNG via `@capacitor/assets` or direct drop into `android/app/src/main/res/mipmap-*/`.
- **Verify:** Home screen shows branded icon labeled "Golden Hour".

#### 4.2 Native toasts via `@capacitor/toast`
- **What:** Route user-visible errors through `Toast.show` on native; inline UI as web fallback.
- **Files:** MODIFY `web/package.json`, `web/app/page.tsx`, `web/lib/speech.ts`.
- **Verify:** Airplane mode → tap mic → toast says "No signal — Golden Hour needs internet for v0."

#### 4.3 Disclaimer persistence
- **What:** Verify "AI-assisted triage — not a medical diagnosis" renders in triage card and onboarding footer.
- **Files:** MODIFY `web/app/onboarding.tsx`.
- **Verify:** Visible on first launch + every dispatch.

**END DAY 4 — COMMIT 5.**

### DAY 5 — Second device + signed release APK

#### 5.1 Install on Keshav's phone
- Different OEM ideally. Full dispatch over cellular (not Wi-Fi). Document OEM-specific quirks (esp. Samsung WebView MediaRecorder codec).

#### 5.2 Signed release APK
```bash
cd android
./gradlew assembleDebug
ls app/build/outputs/apk/debug/app-debug.apk
```
- **Verify:** APK < 25 MB. Install via `adb install` on a third phone.

#### 5.3 Drive upload + QR code
- Upload `app-debug.apk` to shared Drive. Generate QR. Test scan → install flow.
- **Verify:** Cold install < 60s from QR scan to icon.

**END DAY 5 — COMMIT 6.**

---

## 4. Critical files map

### New files
| Path | Purpose |
|---|---|
| `/capacitor.config.ts` | Capacitor app config |
| `/package.json` (root) | Capacitor CLI + plugins |
| `/.gitignore` additions | Exclude `android/build/`, `android/.gradle/`, `android/local.properties` |
| `web/lib/cors.ts` | Shared CORS allowlist + helper |
| `web/lib/api-base.ts` | `apiUrl(path)` prefixer |
| `web/lib/identity.ts` | Preferences load/save + schemaVersion |
| `web/lib/permissions.ts` | Just-in-time grant helpers (optional) |
| `web/app/onboarding.tsx` | First-launch form |
| `android/` | `cap add android` output |
| `resources/icon.png` | Placeholder icon |

### Modified files
| Path | Why |
|---|---|
| `web/next.config.ts` | Conditional `output: 'export'` when `CAPACITOR_BUILD=1`; remove `experimental.serverActions` |
| `web/package.json` | Add `@capacitor/*` plugins |
| `web/app/page.tsx` | `apiUrl()`, onboarding gate, identity from Preferences, native voice-mode filter, JIT permissions |
| `web/app/api/dispatch/route.ts` | CORS wrapper + `OPTIONS` |
| `web/app/api/speech/route.ts` | CORS wrapper + `OPTIONS` |
| `web/lib/geo.ts` | `@capacitor/geolocation` swap |
| `web/lib/speech.ts` | `apiUrl()` + native toasts |
| `web/.env.example` | Document `NEXT_PUBLIC_API_BASE_URL` |

### Untouched intentionally
- `web/lib/agents/dispatcher.ts`, `web/lib/tools/*`, `web/lib/hospitals-seed.ts`, `web/lib/types.ts`, `web/lib/markdown.tsx`, `web/lib/tools/triage-patient.ts`.

---

## 5. Risk register

| # | Risk | Trigger | Fallback |
|---|---|---|---|
| R1 | `output: 'export'` rejects current code | `npm run build` errors mentioning "static export," "server component," "useChat," or "API route" | Switch to remote WebView (`server.url`). Document. Lose offline shell, gain zero rebuild on deploys. |
| R2 | Samsung WebView drops MediaRecorder Opus | Keshav records but Sarvam returns empty/4xx | Force `audio/mp4` first in `pickMime()` when `Capacitor.isNativePlatform()`. |
| R3 | Vercel Hobby 60s cap truncates agent | Real dispatch > 60s | Already known. Keep loops tight. Pro upgrade if needed. |
| R4 | CORS misconfigured on cellular | Logcat shows CORS error | Verify allowlist matches reported origin. Lock `androidScheme: 'https'`. |
| R5 | Capacitor scaffold conflicts with legacy root | `npm init` errors on existing files | Move Capacitor into `/mobile/` with `webDir: '../web/out'`. |
| R6 | `useChat` SSE doesn't render in Android WebView | Mic works, server streams, UI never updates | Switch transport to long-poll or terminal-message rendering. v0 limitation. |
| R7 | Side-load friction at demo | Attendees can't install in < 2 min | Pre-screencast install flow, attach to QR card. Keshav practices. |
| R8 | JDK / ANDROID_HOME setup breaks Gradle | `npx cap run android` gradle sync fails | Day 0 `java -version` check; install JDK 17 via brew if needed. |
| R9 | Twilio sandbox JOIN friction | Attendee phone doesn't receive | `DEMO_WHATSAPP_OVERRIDE_TO` routes everything to Rajeev (pre-joined). Print JOIN code on QR card. |
| R10 | Preferences not encrypted by default | ADB shell shows plain-text caller data | Accept sandboxing as adequate for v0. Document. Secure Storage in v0.1. |

---

## 6. v0 anti-scope (what NOT to do)

In addition to the design brief's "out of scope":

1. No custom theming, splash animations, icon polish until end-to-end works. Day 4 icon is flat red circle.
2. No refactoring `web/app/page.tsx` "for cleanliness." 750-line file stays. Add gate + swap two URLs + filter voice modes — that's it.
3. No analytics, Sentry, telemetry. v0 ships dark. Logcat for debugging.
4. No ProGuard/R8 minification beyond Capacitor defaults. Debug APK.
5. No Capacitor plugin you don't strictly need. Only: `core`, `android`, `preferences`, `geolocation`, `toast`. NOT `@capacitor/app`, `status-bar`, `splash-screen`, `keyboard` unless fixing observed bug.
6. No touching agent/tools/Sarvam server code. Backend stays exactly as is except CORS. If you open `web/lib/agents/dispatcher.ts` or `web/lib/tools/*.ts`, you've gone off-plan.
7. No migrating from `useChat` to custom fetch "because streaming feels flaky." Validate first.
8. No re-introducing Web Speech API for English on APK. Sarvam handles English fine.
9. No hard-coding `https://golden-hour.vercel.app`. Always via `NEXT_PUBLIC_API_BASE_URL`.
10. No Google Play submission. Side-load only.

---

## 7. Commit boundaries

| # | When | Title | Scope |
|---|---|---|---|
| 1 | End Day 1, after 1.4 | `feat(web): CORS + configurable API base URL + Capacitor-ready geolocation` | `web/lib/cors.ts`, API routes, `web/lib/api-base.ts`, URL prefixes in `page.tsx` + `speech.ts`, `geo.ts` Capacitor swap, `.env.example`, `package.json` adds. Web build at localhost:4005 still works. |
| 2 | End Day 1, after 1.8 | `feat(android): Capacitor scaffold + first installable debug APK` | Root config, `android/`, gated `output: 'export'`. `npx cap run android` installs successfully. |
| 3 | End Day 2 | `feat(android): just-in-time permissions + Sarvam-only voice on native` | `web/app/page.tsx` permission gating, native voice-mode filter. Kannada dispatch fires from APK. |
| 4 | End Day 3 | `feat(android): first-launch onboarding + Preferences-backed caller identity` | `onboarding.tsx`, `identity.ts`, `page.tsx` gate + load, `@capacitor/preferences`. Fresh install shows onboarding. |
| 5 | End Day 4 | `feat(android): icon, native toasts, persistent disclaimer` | Icon files, `@capacitor/toast`, disclaimer footer. Branded icon visible, toasts on offline. |
| 6 | End Day 5 | `chore(android): v0 release artifacts + multi-device verification notes` | Release notes in `docs/release/v0-android.md` documenting tested OEMs, quirks, QR URL, side-load instructions. |
