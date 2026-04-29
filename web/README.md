# Golden Hour — Web (Next.js + Agent)

The agentic frontend for Golden Hour. A single tool-calling agent (`/api/dispatch`) coordinates
emergency response: voice → triage → hospital matching → parallel WhatsApp dispatch.

## Stack

- **Next.js 16** (App Router, Turbopack), React 19, Tailwind 4
- **Vercel AI SDK v6** + `@ai-sdk/anthropic` (Claude Haiku 4.5 — agent loop and triage)
- 4 tools: `triagePatient`, `findHospitals` (Google Places + seed fallback), `sendWhatsApp` (Twilio + mock), `searchWeb` (Serper)
- **Voice**: Web Speech API (English, live transcript) + Sarvam `speech-to-text-translate` `saaras:v2.5` (Indian languages, auto-detect → English)
- **Geo**: browser geolocation with Peoria, IL fallback
- **Hospital seeds**: region-aware (`bangalore.json` + `peoria.json`), Jaccard token similarity for name matching with chain-prefix stopwords

## Setup

```bash
cd web
npm install
cp .env.example .env.local   # fill in keys (or use ../.env at repo root)
npm run dev                  # → http://localhost:4005
```

## Required env vars

| Var | Purpose | Required? | Free tier |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | The agent + triage | **yes** | Pay-as-you-go |
| `SARVAM_API_KEY` | Indian-language STT-translate | only if testing non-English voice | Has free tier |
| `GOOGLE_PLACES_API_KEY` | Live hospital lookups | no (falls back to seed) | $200/mo credit |
| `SERPER_API_KEY` | Supplementary web search | no (tool returns error gracefully) | 2,500 free searches |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | Real WhatsApp | no (mocks to console) | Sandbox is free |
| `TWILIO_WHATSAPP_FROM` | Sender number | defaults to Twilio sandbox | — |
| `DEFAULT_COUNTRY_CODE` | Phone-number default (e.g. `1` US, `91` India) | no (defaults to `1`) | — |
| `DEMO_WHATSAPP_OVERRIDE_TO` | Route all 4 dispatches to one tester phone | no | — |

If Twilio is missing, `sendWhatsApp` runs in **mock mode** — it logs the message
to the console and returns `status: "mocked"` so the agent + UI still work end-to-end.

If `DEMO_WHATSAPP_OVERRIDE_TO` is set, every dispatch (hospital / ambulance /
nurse / family) is routed to that single number with a body prefix
`[Demo: → HOSPITAL Saint Francis (+1...)]` so a single tester can see the full
fan-out without each recipient joining the Twilio sandbox separately.

## How it flows

```
mic button → speech.ts
  ├─ English mode → Web Speech API (live transcript, free)
  └─ Indian mode  → MediaRecorder → /api/speech → Sarvam STT-translate

user message + GPS + caller → /api/dispatch (POST)
            → streamText() loop with Haiku 4.5
            → triagePatient (generateObject + Zod → ESI, severity, capabilities)
            → findHospitals (Google Places live + region seed + Jaccard matching)
            → sendWhatsApp × 4 in parallel (hospital, ambulance, nurse, family)
            → SSE stream back → useChat → severity-colored cards rendered
```

Tools return `_card` / `_cards` keys for rich UI rendering. These are stripped
from message history before re-feeding the agent (saves ~20K tokens per turn).

## Schema gotcha (Zod v4 + Anthropic)

When using `generateObject` with `anthropic(...)`, **don't use `.int()`,
`.min()`, `.max()`, `.gte()`, `.lte()`** in Zod schemas. Zod v4 emits JSON
Schema constraints (and `.int()` adds safe-integer `minimum`/`maximum`
bounds) that Anthropic's structured-output endpoint rejects with:
`For 'integer' type, properties maximum, minimum are not supported.`
Express bounds in `.describe()` text only — see `lib/tools/triage-patient.ts`.

## Deploy to Vercel

```bash
vercel
# Add env vars in dashboard
```

`maxDuration` is set to 120s in `app/api/dispatch/route.ts`. Vercel Hobby plan allows up to 60s
unless you upgrade — for the demo, local `npm run dev` is unconstrained.

## Files of interest

- `app/page.tsx` — `useChat` UI, giant mic button, voice-mode picker, GPS badge, severity-colored cards
- `app/api/dispatch/route.ts` — streaming endpoint, history trimming
- `app/api/speech/route.ts` — Sarvam STT-translate proxy (strips codec annotations)
- `lib/agents/dispatcher.ts` — system prompt + agent loop
- `lib/tools/*` — the four tools
- `lib/geo.ts` — `requestGeolocation()` with Peoria fallback
- `lib/speech.ts` — Web Speech + MediaRecorder dual-mode helpers
- `lib/hospitals-seed.ts` — region-aware loader (`../data/hospitals/{bangalore,peoria}.json`)
- `lib/tools/find-hospitals.ts` — Jaccard similarity + chain-prefix stopwords
