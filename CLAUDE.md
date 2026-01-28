# CLAUDE.md — Golden Hour Project Context

## What This Project Is

Golden Hour is an AI-powered emergency response system for India. It aims to save 50,000–100,000 lives annually by compressing emergency response timelines from hours to seconds through voice-first AI coordination.

The core problem: only 7% of trauma patients in India reach hospitals within the golden hour (vs 50% in the USA). 2.4 million Indians die annually from treatable conditions.

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

## License & Attribution

MIT License — Distillery Labs / AI Collective Peoria
