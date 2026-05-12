# CLAUDE.md — Golden Hour Project Context

## What This Project Is

Golden Hour is an AI-powered emergency response system for India. It aims to save 50,000–100,000 lives annually by compressing emergency response timelines from hours to seconds through voice-first AI coordination.

The core problem: only 7% of trauma patients in India reach hospitals within the golden hour (vs 50% in the USA). 2.4 million Indians die annually from treatable conditions.

## Active Builds

The product now has **two living surfaces**, both pointed at the same Vercel
backend:

1. **`web/`** — Next.js 16 + Vercel AI SDK v6 + Claude Haiku 4.5. This is the
   brain and the source of truth for UI/logic. Deployed to
   https://golden-hour-fawn.vercel.app (Vercel team: `the-idea-sandbox`).
2. **`android/` + repo-root Capacitor wrapper** — As of 2026-05-12, a
   Capacitor v7 shell that static-exports `web/` and packages it as an
   installable Android APK. Phone is dumb, all intelligence is on Vercel.

The earlier Vite `/demo/` and the Python/CrewAI backend in `src/` are
**superseded** — kept in the repo for reference only.

### Running the web build (dev)
```bash
cd web
npm install
cp .env.example .env.local   # fill in keys (or use ../.env at repo root)
npm run dev                  # → http://localhost:4005
```

### Running the Android build
```bash
# At repo root:
npm install                  # one-time, installs Capacitor + plugins
npm run sync                 # static-export web/ + cap sync android
npm run android              # static-export + sync + open Android Studio
# In Android Studio: plug phone in (USB Debugging on), click ▶ Run.
```

The repo-root `package.json` is the Capacitor wrapper (NOT the same as
`web/package.json`). Build pipeline:
1. `CAPACITOR_BUILD=1` triggers Next.js `output: "export"` (gated in
   `web/next.config.ts`).
2. Static files land in `web/out/`.
3. `npx cap sync android` copies them to `android/app/src/main/assets/public/`.
4. Android Studio compiles + pushes the APK to the connected phone.

**Important version pin:** Capacitor is on **v7**, not v8. Capacitor 8
needs Node ≥22; this repo's dev machine is Node 20.16. `npm install
@capacitor/*@^7` when adding plugins. If Node gets upgraded to 22+, the
pin can come off.

### Capacitor app identity
- `appId`: `com.distillerylabs.goldenhour`
- `appName`: "Golden Hour"
- `webDir`: `web/out`
- `server.androidScheme`: `https` (in-WebView origin = `https://localhost`,
  needed for the CORS allowlist).
- Custom amber-sunset launcher icon (regenerable via `scripts/gen-icon.py`,
  source PNG at `docs/icon-source-1024.png`).

### What's wired up end-to-end (May 2026)

**Android shell (Capacitor, v0 — installed on Rajeev's phone 2026-05-12):**
- `android/` is a Capacitor v7 native project. `MainActivity.java`
  requests `RECORD_AUDIO` + `ACCESS_FINE_LOCATION` at runtime on first
  launch, and installs a permissive `BridgeWebChromeClient` so WebView
  `getUserMedia` gets the Android-level grants forwarded to it (without
  this bridge the WebView denies the mic silently even after the Android
  prompt is accepted).
- `web/lib/platform.ts` exposes `isNative()` (backed by
  `Capacitor.isNativePlatform()`). The page uses this to:
  - Force `getEngine()` to `"sarvam"` on native (Web Speech API doesn't
    exist in Android WebView).
  - Default the voice mode to `"auto-in"` (Sarvam auto-detect).
- `web/lib/api-base.ts` `apiUrl()` resolves relative paths against
  `https://golden-hour-fawn.vercel.app` when native — **runtime detection,
  not build-time `NEXT_PUBLIC_API_BASE_URL` inlining** (Turbopack's
  inlining was unreliable with the symlinked `.env.local`).
- `web/lib/cors.ts` allowlist includes `capacitor://localhost`,
  `https://localhost`, `http://localhost`, `http://localhost:4005`.
  Both `/api/dispatch` and `/api/speech` serve OPTIONS preflight + stamp
  responses with the matched origin.
- `web/lib/geo.ts` delegates to `@capacitor/geolocation` so the same code
  uses the native location API on Android and `navigator.geolocation` on
  browser via Capacitor's web shim.
- UI affordances added for the Android demo flow:
  - "New" button (header top-right) clears the chat via
    `useChat`'s `setMessages([])` so demo users can reset between
    languages/scenarios without killing the app.

**Voice input — multi-modal:**
- **English path**: Web Speech API (browser-native, free, live transcript as you speak).
- **Indian-language path**: Sarvam `speech-to-text-translate` (`saaras:v2.5`) — single endpoint, auto-detects Kannada/Hindi/Tamil/Telugu and returns English.
- Voice-mode picker in the UI lets you switch between English Web Speech and any Indian language via Sarvam. The `/api/speech` proxy strips codec annotations (`audio/webm;codecs=opus` → `audio/webm`) that Sarvam was rejecting.

**Geolocation:**
- `requestGeolocation()` (`web/lib/geo.ts`) pulls real browser coords with an 8s timeout.
- Falls back to Peoria, IL (40.6936, -89.589) — labeled, never silent. `GpsBadge` shows live coords + accuracy meters.

**Hospital matching — real, region-aware:**
- Live **Google Places API (New)** — `places:searchNearby` with `X-Goog-Api-Key`.
- Region seeds in `data/hospitals/`: `bangalore.json` and `peoria.json` (5 real Peoria-area hospitals with researched capabilities — OSF Saint Francis Level I trauma + cath_lab + neurosurg, OSF Children's NICU, UnityPoint Methodist cath_lab + stroke, Proctor, Pekin).
- **Jaccard token similarity** with chain-prefix stopwords (`OSF`, `UnityPoint`, `Carle`, `Apollo`, `Fortis`, `AIIMS`, …) so "OSF Divine Mercy" doesn't inherit cath-lab capabilities just because the name starts with "OSF". Threshold 0.34.

**WhatsApp dispatch — real Twilio:**
- Twilio sandbox path verified end-to-end (real SIDs delivered).
- `DEMO_WHATSAPP_OVERRIDE_TO` env routes all four recipients (hospital / ambulance / nurse / family) to a single tester phone with `[Demo: → HOSPITAL Saint Francis (intended-number)]` body prefix — so one phone shows the full fan-out without each recipient having to join the sandbox.
- `DEFAULT_COUNTRY_CODE` env (was hardcoded `+91`) — set to `1` for US testing.
- Falls back to mock-mode (logs only) when Twilio creds are absent.

**Triage:**
- `generateObject` with Claude Haiku 4.5 + Zod schema → ESI level, severity, required capabilities, time criticality, first-aid steps.
- **Schema gotcha**: don't use `.int()`, `.min()`, `.max()` in Zod schemas passed to `generateObject` with `anthropic()` — Zod v4 emits JSON Schema constraints (including `minimum`/`maximum` from `.int()`'s safe-integer bounds) that Anthropic's structured-output endpoint rejects. Express bounds in `.describe()` text only.

**Validated agentic behavior:**
- The dispatcher agent runs an **open clarifying-question loop** after first triage (not one-shot). Live-validated 2026-04-28: caller answered follow-ups in Kannada mid-conversation, Sarvam translated each turn, agent kept reasoning in English. Don't refactor into one-shot triage — the multi-turn + per-turn language switch is the demo.

### Active build env vars (`.env` at repo root or `web/.env.local`)
```bash
ANTHROPIC_API_KEY=...               # Claude Haiku 4.5 (agent + triage)
GOOGLE_PLACES_API_KEY=...           # Live nearby-hospital lookups
SARVAM_API_KEY=...                  # Indian-language STT-translate
SERPER_API_KEY=...                  # (optional) supplementary web search
TWILIO_ACCOUNT_SID=...              # WhatsApp sandbox
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
DEFAULT_COUNTRY_CODE=1              # 1=US, 91=India — used by phone normalization
DEMO_WHATSAPP_OVERRIDE_TO=+1...     # Optional: route all dispatches to one phone for demos
```

### Active build file structure
```
# Capacitor wrapper (repo root)
package.json                 # build:web / sync / android scripts (Capacitor)
capacitor.config.json        # appId, webDir, androidScheme
android/                     # Capacitor-generated native project
  app/src/main/
    AndroidManifest.xml      # RECORD_AUDIO, ACCESS_FINE_LOCATION
    java/com/distillerylabs/goldenhour/MainActivity.java
                             # Runtime permission requests +
                             # permissive BridgeWebChromeClient

# Static web app — source of truth for UI + logic
web/
  app/
    page.tsx                 # useChat UI, mic button, voice-mode picker,
                             # severity-colored cards, "New" reset button
    api/
      dispatch/route.ts      # streamText agent loop (120s maxDuration) + CORS
      speech/route.ts        # Sarvam STT-translate proxy + CORS
  lib/
    agents/dispatcher.ts     # System prompt + tool registration
    tools/
      triage-patient.ts      # generateObject + Zod → ESI, severity, capabilities
      find-hospitals.ts      # Google Places + seed fallback + Jaccard matching
      send-whatsapp.ts       # Twilio + mock fallback + override routing
      search-web.ts          # Serper (optional)
    api-base.ts              # apiUrl() — runtime native detection → Vercel URL
    cors.ts                  # CORS allowlist + preflight helper
    platform.ts              # isNative() — Capacitor.isNativePlatform() wrapper
    geo.ts                   # @capacitor/geolocation + Peoria fallback
    speech.ts                # Web Speech API + MediaRecorder→Sarvam dual-mode
    hospitals-seed.ts        # Region-aware seed loader (Bangalore + Peoria)
data/hospitals/
  bangalore.json             # Indian seed
  peoria.json                # Peoria seed (5 hospitals, real capabilities)

# Reproducible app-icon generation
scripts/gen-icon.py          # Renders Android icon set from a single source
docs/icon-source-1024.png    # 1024×1024 source (amber gradient + white cross)
docs/grill/                  # Design brief + plan from the 2026-05-02 grill-me
  grill-2026-05-02-golden-hour-android-v0.md
  plan-2026-05-02-android-v0-capacitor.md
```

### Kannada test phrases
```
ಸಹಾಯ ಮಾಡಿ! ನನ್ನ ಅಜ್ಜನಿಗೆ ಏನೋ ಆಗಿದೆ!
(Help! Something has happened to my grandfather!)

ಅವರಿಗೆ ಎದೆ ನೋವು ಬರ್ತಿದೆ, ತುಂಬಾ ಬೆವರ್ತಿದ್ದಾರೆ
(He's having chest pain and sweating a lot)

ಅವರ ಎಡ ಕೈ ಜೋಮು ಹಿಡಿದಿದೆ, ಉಸಿರಾಡೋಕೆ ಕಷ್ಟ ಆಗ್ತಿದೆ
(His left arm is numb and he's having trouble breathing)
```

### Known gaps
- **TTS for illiterate callers** — agent replies are text-only. Plan: stream the agent's text deltas through Sarvam TTS (Indian languages) or ElevenLabs/OpenAI TTS (English) and play in-browser. Deferred until after real-Twilio wiring (now done).
- **Android v0 → v1 polish remaining** (from `docs/grill/plan-2026-05-02-android-v0-capacitor.md`):
  - Day 3 — first-launch onboarding screen + `@capacitor/preferences`-backed identity (name/phone/family contacts persisted on-device instead of `NEXT_PUBLIC_DEMO_*` env defaults).
  - Day 4 — native toast for errors instead of inline "tap for details", persistent legal disclaimer ("AI-assisted triage — not a medical diagnosis").
  - Day 5 — Keshav's phone install, signed debug APK, QR-code distribution for side-load.
- **Background/lock-screen guidance** — closing the Android app stops the agent stream. Real emergency use needs a foreground service so CPR coaching keeps streaming even when the screen is locked.
- **Twilio out of sandbox** — recipients still need to join the Twilio WhatsApp sandbox first; production Twilio number unblocks "any phone" delivery.
- **Speaker diarization** — see "Future Considerations" below.

---

## Legacy: Python/CrewAI backend (`src/`) and Vite demo (`demo/`)

These directories are **superseded** by `web/` but kept for reference. The
descriptions below document what they were intended to do; nothing in
`src/` returns more than placeholder responses. New work should target
`web/` only.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI (Python), uvicorn |
| AI Agents | CrewAI 0.95.0 + Claude API (Anthropic) |
| Speech | Bhashini + Sarvam AI + OpenAI Whisper (Indian languages: Hindi, Tamil, Telugu, Kannada, English, Hinglish) |
| Database | PostgreSQL 16 with PostGIS + Redis 7 |
| Communications | Twilio (SMS/voice) + Firebase (push notifications) |
| Mapping | Google Maps Platform |
| Mobile | React Native 0.73.0 |
| ORM | SQLAlchemy 2.0 |

## Project Structure

```
src/
  backend/
    main.py              # FastAPI app entry point (port from APP_PORT env, default 8000)
    speech/router.py     # POST /api/v1/speech/transcribe
    triage/router.py     # POST /api/v1/triage/classify
    dispatch/router.py   # POST /api/v1/dispatch/initiate
    notifications/router.py  # POST /api/v1/notifications/send
  agents/
    main.py              # CrewAI crew initialization (sequential 4-agent pipeline)
    transcription_agent.py   # Speech processing + location extraction
    triage_agent.py          # Medical classification (uses Claude)
    dispatch_agent.py        # Parallel dispatch coordination
    monitoring_agent.py      # Real-time guidance + monitoring
  mobile/
    components/
      EmergencyButton/   # One-tap emergency activation
      VoiceRecorder/     # Audio capture + streaming
      StatusDisplay/     # Real-time dispatch status
data/
  hospitals/bangalore.json   # Seeded hospital capabilities database
  protocols/cpr_english.md   # CPR voice guidance protocol
  translations/              # Multi-language resources (empty)
tests/
  backend/test_triage.py     # Health + triage classification tests
scripts/
  seed_hospitals.py          # Hospital database seeder
  test_triage.py             # Quick triage test script
infra/
  kubernetes/                # Placeholder
  terraform/                 # Placeholder
```

## Key Architecture Patterns

1. **Sequential Agent Pipeline**: Transcription → Triage → Dispatch → Monitoring
2. **Parallel Dispatch**: Dispatches to 108 (Indian emergency), hospitals, first responders, and family simultaneously — NOT sequentially. This is a deliberate design choice because India's emergency systems have gaps.
3. **Capability-Based Matching**: Routes to the nearest facility with the *required capabilities* (e.g., cath_lab, trauma center), not just the nearest facility.
4. **Voice-First, Multi-Language**: Designed for Hindi/English code-switching (Hinglish) and distressed speech patterns.
5. **Bystander Guidance Loop**: Maintains active voice guidance (e.g., CPR instructions) while waiting for responders.

## Implementation Status

**Complete (scaffold):**
- FastAPI app with 4 routers and health endpoints
- CrewAI 4-agent crew definitions
- Docker Compose for PostgreSQL+PostGIS and Redis
- Hospital seed data (Bangalore — 2 hospitals)
- CPR protocol documentation
- Basic test framework
- Mobile component directory structure
- Environment config template (.env.example)

**Not yet implemented (all endpoints return placeholder responses):**
- Speech-to-text integration (Bhashini/Sarvam AI)
- Triage classification logic (Claude API not wired in backend router)
- Dispatch orchestration (parallel channel activation)
- Notification delivery (Twilio/Firebase)
- Mobile UI components (all empty)
- SQLAlchemy models and database migrations
- WebSocket real-time updates
- Hospital verification workflow
- Integration tests

## Running the Project

```bash
# Start databases
docker-compose up -d

# Install Python dependencies
pip install -r requirements.txt

# Run backend
uvicorn src.backend.main:app --reload --port 8000

# Run tests
pytest tests/
```

## Environment Variables

See `.env.example` for the full list. Key ones:
- `ANTHROPIC_API_KEY` — Claude API
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — SMS/Voice
- `GOOGLE_MAPS_API_KEY` — Location services
- `BHASHINI_API_KEY`, `BHASHINI_USER_ID` — Indian language STT
- `SARVAM_API_KEY` — Fallback STT
- `DATABASE_URL` — PostgreSQL (default: postgresql://goldenhour:goldenhour@localhost:5432/goldenhour)
- `REDIS_URL` — Redis (default: redis://localhost:6379/0)

## Future Considerations

### Hospital Capability Matching (India)
The challenge: Google Places API finds nearby hospitals but doesn't provide:
- Available equipment (CT, MRI, cath lab, ventilators)
- Specialty departments
- Real-time bed/ICU availability
- On-call specialists

**Potential Solutions:**
1. **ABDM Health Facility Registry (HFR)** - 3.6 lakh facilities registered
   - Portal: https://facility.abdm.gov.in/
   - Sandbox API: https://sandbox.abdm.gov.in/
2. **Open Government Data** - https://data.gov.in/keywords/Bed
3. **COVID-era APIs** - Some real-time bed APIs may still work
4. **State partnerships** - Delhi had coronabeds.jantasamvad.org

### Speaker Diarization
Problem: Multiple people may speak during an emergency call.

**Scenarios:**
- Patient calls, then passes out → bystander continues
- Bystander calls on behalf of patient
- Noisy scene with multiple voices

**Potential Solutions:**
1. Lock onto first speaker's voice fingerprint
2. Label speakers in transcript: [CALLER], [BACKGROUND]
3. Use 3rd-person detection: "HE has chest pain" vs "I have chest pain"

Current workaround: NLP extracts symptoms from content regardless of speaker.

### AI Triage Engine — Research & Roadmap (February 2026)

**Current:** Claude Sonnet via Anthropic API (prototyping phase).
**Long-term target:** Self-hosted OpenBioLLM-70B (open source, no API costs, full data privacy).

#### Triage Standard: Emergency Severity Index (ESI)
The ESI is the most widely adopted triage framework globally, including Indian hospitals. 5 levels:
- ESI-1: Immediate life-threatening (cardiac arrest, not breathing)
- ESI-2: High risk / altered mental status / severe pain (stroke, chest pain)
- ESI-3: Multiple resources needed (fracture + laceration)
- ESI-4: One resource needed (simple laceration)
- ESI-5: No resources needed (cold symptoms)

Our `triageScore` (1-10) should eventually align to ESI 1-5 for hospital interoperability.

#### India Regulatory Landscape (CDSCO)
CDSCO released Draft Guidance on Medical Device Software (Oct 2025) distinguishing:
- **SaMD (Software as Medical Device)** — standalone diagnostic → Class C/D approval needed
- **CDS (Clinical Decision Support)** — aids human decision-making → lighter regulation

**Golden Hour is CDS, not SaMD.** We extract symptoms and route — humans make final decisions.
Must display: *"AI-assisted triage — not a medical diagnosis. Final decisions made by medical professionals."*

Reference: https://corporate.cyrilamarchandblogs.com/2026/01/medical-device-as-software-has-cdsco-guidance-changed-the-rules/

#### Model Comparison (as of Feb 2026)

| Option | Cost | Medical Accuracy | JSON Support | Notes |
|--------|------|-----------------|--------------|-------|
| Claude Sonnet (current) | ~$3/1M input | Excellent | Prompt-based | Currently integrated |
| Gemini 2.5 Flash | **Free** (1000 req/day) | Very good | Native JSON Schema | Best free option |
| Groq (Llama 3) | ~$0.20/1M | Good | Prompt-based | Fastest inference |
| **OpenBioLLM-70B** | **Free (self-hosted)** | **86%+ (beats Med-PaLM-2)** | Prompt-based | **Long-term target** |
| BioMistral-7B | Free (self-hosted) | Good for 7B | Prompt-based | Lighter alternative |
| Meditron-70B | Free (self-hosted) | Trained on medical guidelines | Prompt-based | EPFL medical LLM |

**Recommended production path:**
1. Now: Claude Sonnet (prototyping, already integrated)
2. Next: Gemini Flash free tier (cost savings, native structured output)
3. Production: OpenBioLLM-70B self-hosted (best medical accuracy, zero API cost, data sovereignty)

**Key references:**
- OpenBioLLM: https://huggingface.co/blog/aaditya/openbiollm
- Meditron: https://github.com/epfLLM/meditron
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini free tier: https://ai.google.dev/gemini-api/docs/pricing
- CDSCO SaMD guidance: https://www.india-briefing.com/news/cdsco-draft-guidance-medical-software-40691.html/

## License & Attribution

MIT License — Distillery Labs / AI Collective Peoria
