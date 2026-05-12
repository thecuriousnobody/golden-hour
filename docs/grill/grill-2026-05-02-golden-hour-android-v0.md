# Design Brief — Golden Hour Android v0 (Capacitor Wrapper)

**Date:** 2026-05-02
**Author:** Rajeev (with Claude grill-me, Sprint mode)
**Status:** Draft · pre-implementation · ready to code

## One-line scope
Wrap the existing `web/` Next.js + Vercel AI SDK build inside an Android Capacitor shell so the user can install an APK, tap a big red mic on the home screen, speak their emergency, and trigger the full triage → hospital match → WhatsApp dispatch pipeline — same as the web app, but as a real installed app.

## Why this, why now
The web build is feature-complete and demo-ready (real GPS, live Google Places, real Twilio WhatsApp, multilingual Sarvam STT, Claude Haiku 4.5 agent). The friction now is **distribution**: handing a URL to demo attendees isn't a real product moment. An installed app on your home screen — even a thin one — changes the perception from "cool web demo" to "I have an emergency app on my phone." This is also the cheapest possible bridge to a future native build where the platform-only features (lockscreen activation, real 911 dial-out, foreground service) actually matter.

## Who it's for
**Primary**: anyone with an Android phone who might face a medical emergency for themselves or a bystander — initially Rajeev + Keshav for v0 testing, expanding to AI Collective Peoria / Vibe Coding meeting attendees who side-load the APK.
**Context**: untrained caller, possibly distressed, possibly speaking an Indian language, possibly with bad signal. Must feel as effortless as opening a flashlight app.

## In scope (v0)
- Capacitor 6.x Android wrapper around the existing `web/` Next.js app
- Package ID `com.distillerylabs.goldenhour`, display name "Golden Hour"
- Backend continues to live on Vercel; APK calls the deployed `/api/dispatch` URL
- Sarvam-only voice path (`/api/speech` → `saaras:v2.5`) — single code path for English + all Indian languages
- Just-in-time mic + location permission prompt on first dispatch button tap
- First-launch onboarding (3 fields: caller name, caller phone, one emergency contact name+phone) persisted via Capacitor `Preferences`
- Side-loadable APK distribution (USB / Drive link) — no Play Store yet
- Demoable at the next Vibe Coding meeting on Rajeev's + Keshav's phones

## Out of scope (explicitly)
- **Lockscreen activation / SOS gesture** — needs full native, deferred to v1+
- **Real phone dial-out to 911 / 108** — `Intent.ACTION_CALL`, needs native escape hatch, deferred
- **Foreground service / background agent** — Capacitor WebView dies when backgrounded; live with it for v0
- **Offline / no-signal fallback** — fail with toast; designing offline-first is multi-week work without real user data
- **SMS fallback via `SmsManager`** — would force native scope creep; revisit once we know it matters
- **Push notifications** — deferred to v0.1 once a real backend-push path exists
- **English Web Speech API path** — broken in Android WebView; dropped intentionally in favor of Sarvam-everywhere
- **Google Play Store** — Internal Testing track is v0.2 territory; public listing is months out
- **Custom theming / splash / icon polish** — v0 ships with default + a minimal icon; polish is v0.1
- **Multi-tenant / per-user persistence on backend** — caller identity lives on-device only in v0

## How it works (happy path)
1. User taps "Golden Hour" icon on their Android home screen.
2. **First launch only**: onboarding screen — "Who are you? Who should we alert?" — three fields (name, phone, one emergency contact). Saved to encrypted on-device `Preferences`. Skip-able after first run.
3. Main screen loads (the existing `web/app/page.tsx` UI inside a WebView): giant red mic, voice-mode picker (defaults to English, dropdown reveals Kannada/Hindi/Tamil/Telugu/auto), GPS badge.
4. User taps the mic. **First time ever**: Android prompts for mic + location permission together. User taps "Allow" for both. Recording starts.
5. User speaks: *"Help, my grandfather is having chest pain."*
6. On release, audio uploads to `/api/speech` (Vercel) → Sarvam returns English text. Transcript appears.
7. Transcript + GPS + caller identity POSTs to `/api/dispatch`. Claude Haiku 4.5 agent runs the full loop: triage → find-hospitals (Google Places + Peoria/Bangalore seed) → 4 parallel WhatsApp sends via Twilio (hospital, ambulance, nurse, family).
8. UI streams in: triage card (severity + ESI + first-aid), hospital cards (with capability matches), four color-coded WhatsApp confirmation cards (red/amber/sky/violet bars).
9. User's phone buzzes with the actual WhatsApp messages (via `DEMO_WHATSAPP_OVERRIDE_TO` routing all 4 to one tester phone during demo).
10. Agent continues clarifying-question loop if more info is needed. User can answer in any supported language mid-conversation.

## Failure modes & graceful behavior

| When | What the user sees | What the system does |
|---|---|---|
| No internet on tap | Red toast: "No signal — Golden Hour needs internet for v0. Move to better signal and retry." | Aborts dispatch, no queued retry |
| Mic permission denied | Inline help text below mic: "Tap to enable microphone in Settings" with a deep-link button to app permissions | Mic button visually disabled |
| Location permission denied | GPS badge shows "Peoria, IL (fallback)" in amber | Dispatch proceeds with fallback coords + flag passed to agent |
| Sarvam STT fails (network/timeout) | Toast: "Couldn't transcribe — type your situation instead?" + reveals a text input fallback | Falls back to text mode for that turn |
| Vercel `/api/dispatch` 5xx / timeout (> 120s) | Toast: "Dispatch system unreachable — try again in 30s" | Agent stream aborted, partial cards remain on screen |
| Twilio fails for one recipient | That recipient's card renders red ("failed") with the error; other 3 still succeed | No retry — visible failure is the design |
| User backgrounds the app mid-dispatch | WebView pauses; on resume, in-flight stream is gone but completed cards are still visible | Document as v0 limitation, fixed by foreground service in v1 |
| App force-closed during onboarding | Onboarding shows again next launch | Identity only saved after user taps "Save" |

## Data & state
- **On-device (Capacitor `Preferences`, encrypted on Android Keystore-backed storage)**:
  - `callerName` (string)
  - `callerPhone` (E.164 string)
  - `familyName` (string)
  - `familyPhone` (E.164 string)
  - `onboardingComplete` (boolean)
- **Per-session (in-memory only, React state)**:
  - Current GPS fix
  - Voice mode selection
  - Active chat thread
- **Server-side**: nothing persisted in v0. Each dispatch is a fresh request; no user accounts, no history, no analytics. Backend remains stateless (matches current `web/` build).

## Integrations & dependencies
- **Capacitor 6.x** (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`) — Android wrapper
- **`@capacitor/preferences`** — encrypted on-device key-value store for caller identity
- **`@capacitor/geolocation`** — native geolocation (replaces / augments `web/lib/geo.ts` browser API in the wrapped context)
- **`@capacitor/toast`** — native error toasts
- **Existing backend (no changes)**: Vercel deployment of `web/`, `/api/dispatch`, `/api/speech`
- **Existing external APIs (no changes)**: Anthropic (Haiku 4.5), Sarvam, Google Places (New), Twilio WhatsApp Sandbox

## Constraints
- **Performance**: cold app launch < 3s on a mid-range Android (Pixel 6a class). WebView first paint < 1s after launch.
- **APK size**: target < 25 MB (Capacitor + Next.js export should land around 15–20 MB).
- **Cost**: zero new infra cost. Sarvam + Anthropic + Google Places + Twilio costs are unchanged — same backend calls, just from a different client.
- **Compliance**: still "CDS not SaMD" — must show the "AI-assisted triage — not a medical diagnosis" disclaimer on first-run and somewhere persistent in the UI (already in web build; verify it survives the wrap).
- **Demo deadline**: next Vibe Coding meeting. Target: APK on Rajeev's + Keshav's phones, end-to-end dispatch working over cellular (not just home Wi-Fi).
- **Build environment**: macOS, Android Studio + SDK already installed at `~/Library/Android/sdk`, `adb` in PATH.

## Open questions / deferred decisions
- **Static-export compatibility**: Next.js app uses server-side `/api/*` routes — these stay on Vercel, but the *client* needs to be exported as static assets to ship inside the APK. Need to verify `next build` + `next export` (or `output: 'export'`) works with the current App Router code. If `useChat` or any RSC behavior breaks under static export, we'll need an adapter step. *(Coder: this is the first thing to validate.)*
- **API base URL handling**: relative URLs (`/api/dispatch`) won't resolve inside a Capacitor WebView. Need to introduce a `NEXT_PUBLIC_API_BASE_URL` env var and prefix all fetch calls. Browser falls back to relative; APK uses the full Vercel URL.
- **CORS on Vercel**: Capacitor WebView origin is `https://localhost` or `capacitor://localhost`. Vercel `/api/*` routes must allow these origins explicitly.
- **Twilio sandbox JOIN message**: every new demo attendee still has to text `join <code>` to the Twilio sandbox before they can receive WhatsApp. For Vibe Coding demo we'll use `DEMO_WHATSAPP_OVERRIDE_TO` to route everything to one number (Rajeev's). Document the JOIN-once flow in onboarding for v0.1.
- **Icon + splash**: minimal placeholder for v0 (red circle on white) — actual brand asset deferred.

## Risks
- **Risk**: Capacitor WebView's media-capture stack on some Android OEMs (Samsung, Xiaomi) may handle MediaRecorder differently than Chrome — Sarvam upload could fail silently.
  - **Mitigation**: test on at least 2 different Android phones (Rajeev's + Keshav's, ideally different OEMs) before demo. Add explicit codec logging.
- **Risk**: Next.js 16 + App Router static export may have rough edges with the current `useChat` streaming hook.
  - **Mitigation**: validate first; if it breaks, alternative is to point Capacitor at the live Vercel URL as a "remote WebView" — same UX, no export step, but app is useless offline (which is fine for v0).
- **Risk**: The agent's 120s `maxDuration` on Vercel Hobby is capped at 60s — long agent loops may truncate.
  - **Mitigation**: already a known web-build constraint; not new. Upgrade to Pro tier if it bites.
- **Risk**: Side-loading APKs requires users to enable "Install from Unknown Sources" — adds friction at the demo moment.
  - **Mitigation**: prepare a QR code that links to a Drive-hosted APK + 30-second instruction card. Practice with Keshav first.

## Rollout sketch
1. **Day 1**: Capacitor scaffold, verify Next.js static export, point at Vercel backend, "hello world" APK installs on Rajeev's phone.
2. **Day 2**: Wire permissions (mic + location), test Sarvam recording end-to-end on real device, verify Twilio fan-out works from the APK.
3. **Day 3**: First-launch onboarding screen, `Preferences` persistence, replace env-var caller identity with on-device values.
4. **Day 4**: Polish — icon, splash, error toasts, the four color-coded WhatsApp cards (already done in web), final disclaimer copy.
5. **Day 5**: Install on Keshav's phone, run a full dispatch over cellular (not Wi-Fi), iterate on any device-specific bugs. Build signed release APK, host on Drive, generate QR code.
6. **Demo day**: ~3 attendees side-load, each triggers a dispatch, all 4 WhatsApp messages land on Rajeev's phone (via override), screen-record the experience.

**Safety net**: at every step, the web build on Vercel keeps working. If the APK falls over mid-demo, the URL is the live fallback.

## Decisions log (the grilling)
- **Q1: Backend topology?** **A: Vercel.** *(Emergency apps must work off-Wi-Fi; need a real URL anyway; cleanest separation of concerns.)*
- **Q2: Package ID?** **A: `com.distillerylabs.goldenhour`.** *(Matches existing org branding; permanent commitment.)*
- **Q3: Microphone path?** **A: Sarvam-only (all languages).** *(Web Speech API doesn't work in Android WebView; Sarvam handles English fine; single code path.)*
- **Q4: Permission flow?** **A: Just-in-time mic + location at first mic tap.** *(Highest grant rate; honest UX; tied to visible action.)*
- **Q5: Offline behavior?** **A: Fail with toast.** *(Offline-first is multi-week work; ship the happy path first; honest v0 limitation.)*
- **Q6: Distribution?** **A: Side-load APK.** *(Play Store review burns days; iterate fast first.)*
- **Q7: Caller identity?** **A: First-launch onboarding screen, persisted in Capacitor Preferences.** *(Makes the APK actually usable by anyone, not just Rajeev; ~30 lines of code.)*
- **Q8: v0 ship definition?** **A: APK on Rajeev's + Keshav's phones, side-loadable for Vibe Coding meeting.** *(Concrete, demoable, generates real feedback to drive v0.1 priorities.)*
