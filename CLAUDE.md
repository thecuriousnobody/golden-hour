# CLAUDE.md — Golden Hour Project Context

## What This Project Is

Golden Hour is an AI-powered emergency response system for India. It aims to save 50,000–100,000 lives annually by compressing emergency response timelines from hours to seconds through voice-first AI coordination.

The core problem: only 7% of trauma patients in India reach hospitals within the golden hour (vs 50% in the USA). 2.4 million Indians die annually from treatable conditions.

## Interactive Demo (React/Vite)

A working demo UI is available in `/demo/` for presentations and testing.

### Running the Demo
```bash
cd demo
npm install
npm run dev
# Opens at http://localhost:5173/
```

### Demo Features (February 2026)
- **Real-time Kannada Speech Recognition** - Google Web Speech API (free, no key needed)
- **Live Translation to English** - Sarvam AI Translate API
- **Symptom Extraction** - Keyword-based extraction from English translation
- **Session Persistence** - localStorage saves all emergency sessions
- **Session History** - View past transcriptions with symptoms extracted

### Demo Environment Variables
```bash
# demo/.env
VITE_SARVAM_API_KEY=your_sarvam_api_key  # For Kannada→English translation
```

### Demo File Structure
```
demo/
  src/
    screens/
      HomeScreen.tsx       # Main screen with emergency button + history panel
      ListeningScreen.tsx  # Voice recording + transcription + translation
      DispatchScreen.tsx   # Dispatch confirmation
    services/
      speechApi.ts         # Google Web Speech + Sarvam Translate APIs
      sessionStorage.ts    # localStorage persistence for sessions
      sarvamApi.ts         # Sarvam speech-to-text (backup)
    hooks/
      useVoiceRecorder.ts  # Microphone capture hook
    components/
      EmergencyButton.tsx  # Main SOS button
      Waveform.tsx         # Audio visualization
```

### Kannada Demo Phrases (for testing)
```
ಸಹಾಯ ಮಾಡಿ! ನನ್ನ ಅಜ್ಜನಿಗೆ ಏನೋ ಆಗಿದೆ!
(Help! Something has happened to my grandfather!)

ಅವರಿಗೆ ಎದೆ ನೋವು ಬರ್ತಿದೆ, ತುಂಬಾ ಬೆವರ್ತಿದ್ದಾರೆ
(He's having chest pain and sweating a lot)

ಅವರ ಎಡ ಕೈ ಜೋಮು ಹಿಡಿದಿದೆ, ಉಸಿರಾಡೋಕೆ ಕಷ್ಟ ಆಗ್ತಿದೆ
(His left arm is numb and he's having trouble breathing)
```

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

## License & Attribution

MIT License — Distillery Labs / AI Collective Peoria
