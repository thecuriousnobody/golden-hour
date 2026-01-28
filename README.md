# Golden Hour: AI-Powered Emergency Response for India

**Mission**: Save 50,000-100,000 lives annually by compressing the emergency response timeline from hours to seconds through voice-first AI coordination.

## The Problem

- **2.4 million Indians die annually** from treatable conditions
- Only **7% of trauma patients** reach hospitals within the golden hour (vs 50% in USA)
- **50% of road accident deaths** (150,000-270,000 annually) are preventable with golden hour care
- **700,000 cardiac arrests/year**, 80% outside hospitals, 2-10% survival rate
- **58,000 snakebite deaths/year** — 77% die before reaching care

**This is a coordination failure, not a capability failure.** The treatments exist. The hospitals exist. The ambulances exist. What's missing is the orchestration layer that connects them.

## The Solution

A mobile app where users tap one button, speak in any language, and AI handles everything from transcription to dispatch — with no human bottleneck.

### How It Works

1. **The Incident (0-60s)**: User taps emergency button, speaks in any language. AI transcribes, triages, geolocates, and identifies the nearest *appropriate* facility simultaneously.
2. **The Dispatch (60-90s)**: AI dispatches multiple pathways in parallel — 108 ambulance, hospital notification, first responders, family alerts.
3. **The Bridge (while waiting)**: AI stays on the line guiding bystanders through CPR or first aid, monitoring symptoms, building a real-time medical record.
4. **The Handoff**: Arriving responders receive a structured packet. Receiving hospital is already prepped.

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Mobile | React Native | Cross-platform app |
| Backend | Python / FastAPI | API services |
| AI Agents | CrewAI + Claude API | Multi-agent coordination |
| Speech | Bhashini + Sarvam AI | Indian language STT |
| Database | PostgreSQL + Redis | Persistent + real-time |
| Comms | Twilio + Firebase | SMS, voice, push notifications |
| Maps | Google Maps Platform | Routing, facility search |

## Repository Structure

```
golden-hour/
├── README.md
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── API_SPEC.md
│   └── research/
├── src/
│   ├── mobile/          # React Native app
│   ├── backend/         # FastAPI services
│   │   ├── speech/      # Transcription service
│   │   ├── triage/      # AI triage engine
│   │   ├── dispatch/    # Orchestration layer
│   │   └── notifications/
│   ├── agents/          # CrewAI agents
│   └── shared/          # Common utilities
├── data/
│   ├── hospitals/       # Hospital capability database
│   ├── protocols/       # Medical protocols (CPR, etc.)
│   └── translations/    # Multi-language resources
├── tests/
├── infra/               # Deployment configs
└── scripts/
```

## MVP Scope (Phase 1)

- [ ] One-tap emergency button
- [ ] Voice input in Hindi, English, Hinglish
- [ ] Basic symptom extraction (cardiac, trauma, choking)
- [ ] GPS location capture
- [ ] Single hospital notification (partner hospital)
- [ ] Family SMS notification
- [ ] Voice-guided CPR instructions

## Getting Started

```bash
# Clone the repository
git clone https://github.com/thecuriousnobody/golden-hour.git
cd golden-hour

# Set up Python environment
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt

# Set environment variables
cp .env.example .env
# Edit .env with your API keys

# Start local services
docker-compose up -d  # Redis, PostgreSQL

# Run the backend
python src/backend/main.py

# Run tests
pytest tests/
```

## Contributing

This is an open-source humanitarian project. See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for details.

## License

MIT License - Use this to save lives anywhere.

## Acknowledgments

- Dr. Srikanth Srinivasan - Medical guidance
- The Idea Sandbox Podcast - Platform for this vision
- AI Collective Peoria - Community support
- Distillery Labs - Infrastructure

---

> *"There is a golden hour between life and death. If you are critically injured you have less than 60 minutes to survive."*
> — Dr. R Adams Cowley, 1975
