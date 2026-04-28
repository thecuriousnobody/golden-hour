# Golden Hour — Web (Next.js + Agent)

The agentic frontend for Golden Hour. A single tool-calling agent (`/api/dispatch`) coordinates
emergency response: triage → hospital matching → parallel WhatsApp dispatch.

## Stack

- **Next.js 16** (App Router), React 19, Tailwind 4
- **Vercel AI SDK v6** + `@ai-sdk/anthropic` (Claude Haiku 4.5 throughout — agent loop and triage)
- 4 tools: `triagePatient`, `findHospitals` (Google Places + seed fallback), `sendWhatsApp` (Twilio + mock), `searchWeb` (Serper)

## Setup

```bash
cd web
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # → http://localhost:4005
```

## Required env vars

| Var | Purpose | Required? | Free tier |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | The agent + triage | **yes** | Pay-as-you-go |
| `GOOGLE_PLACES_API_KEY` | Live hospital lookups | no (falls back to seed) | $200/mo credit |
| `SERPER_API_KEY` | Supplementary web search | no (tool returns error gracefully) | 2,500 free searches |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | Real WhatsApp | no (mocks to console) | Sandbox is free |
| `TWILIO_WHATSAPP_FROM` | Sender number | defaults to Twilio sandbox | — |

If Twilio is missing, `sendWhatsApp` runs in **mock mode** — it logs the message
to the console and returns `status: "mocked"` so the agent + UI still work end-to-end.

## How it flows

```
user message → /api/dispatch (POST)
            → streamText() loop
            → triagePatient (Sonnet 4.5)
            → findHospitals (Google Places + seed)
            → sendWhatsApp × 4 in parallel (hospital, ambulance, nurse, family)
            → SSE stream back → useChat → cards rendered
```

Tools return `_card` / `_cards` keys for rich UI rendering. These are stripped
from message history before re-feeding the agent (saves ~20K tokens per turn).

## Deploy to Vercel

```bash
vercel
# Add env vars in dashboard
```

`maxDuration` is set to 120s in `app/api/dispatch/route.ts`. Vercel Hobby plan allows up to 60s
unless you upgrade — for the demo, local `npm run dev` is unconstrained.

## Files of interest

- `app/api/dispatch/route.ts` — streaming endpoint, history trimming
- `lib/agents/dispatcher.ts` — system prompt + agent loop
- `lib/tools/*` — the four tools
- `lib/hospitals-seed.ts` — loads `../data/hospitals/bangalore.json`
- `app/page.tsx` — `useChat` UI with severity-colored cards
