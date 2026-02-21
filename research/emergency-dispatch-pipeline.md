# Golden Hour: Emergency Dispatch Pipeline — Research Report

**Date:** February 2026
**Scope:** End-to-end pipeline from AI triage through dispatch, family tracking, and live status updates

---

## Table of Contents

1. [AI Triage Pipeline](#1-ai-triage-pipeline)
2. [Ambulance Dispatch (108 + Private)](#2-ambulance-dispatch)
3. [Hospital Dispatch & Capability Matching](#3-hospital-dispatch--capability-matching)
4. [Off-Duty Nurses Pager System](#4-off-duty-nurses-pager-system)
5. [GPS Tracker for Family](#5-gps-tracker-for-family)
6. [Live Status Updates & Family Anxiety Reduction](#6-live-status-updates--family-anxiety-reduction)
7. [Privacy & Regulatory Compliance (DPDPA)](#7-privacy--regulatory-compliance)
8. [Recommended Architecture](#8-recommended-architecture)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Sources](#10-sources)

---

## 1. AI Triage Pipeline

### 1.1 ESI Classification with LLMs

The Emergency Severity Index (ESI) Version 5 is the standard triage framework. The ESI decision tree:

```
1. Is the patient dying (requires immediate life-saving intervention)?
   YES → ESI-1
   NO  → continue

2. High-risk situation? Confused/lethargic? Severe pain/distress?
   YES → ESI-2
   NO  → continue

3. How many resources will this patient need?
   0 resources → ESI-5
   1 resource  → ESI-4
   2+ resources → ESI-3
```

**LLM accuracy findings:**
- ChatGPT achieved 76.6% overall ESI accuracy, with **Cohen's Kappa of 0.828 for ESI-1/ESI-2** (the critical cases Golden Hour targets) — [Scientific Reports 2024](https://www.nature.com/articles/s41598-024-73229-7)
- LLMs recognized high-acuity patients at 87.8% vs. triage nurses at 32.7% — [AJEM 2025](https://www.sciencedirect.com/science/article/abs/pii/S0735675724007071)
- The KATE NLP+ML system achieved 80% accuracy on ESI-2/3 boundary vs. 41.4% for nurses

**Bottom line:** LLMs are particularly strong at ESI-1 and ESI-2 identification — exactly our use case.

### 1.2 Recommended Triage Schema (Structured Output)

Claude now supports guaranteed JSON schema compliance via structured outputs (beta since Nov 2025). This replaces the fragile string-stripping in the demo's `vite-api-plugin.ts`.

```python
class TriageAssessment(BaseModel):
    symptoms: list[ExtractedSymptom]
    patient: PatientDemographics
    likely_condition: str
    differential_diagnoses: list[str]       # Max 3
    esi_level: int                           # 1-5
    severity: SeverityLabel                  # CRITICAL/HIGH/MODERATE/LOW
    triage_score: int                        # 1-10 (granular)
    required_capabilities: list[HospitalCapability]
    time_criticality_minutes: int
    recommended_first_aid: Optional[str]
    clinical_reasoning: str                  # Chain-of-thought
    confidence: float                        # 0.0-1.0
    disclaimer: str                          # Mandatory CDS disclaimer

class ExtractedSymptom(BaseModel):
    description: str          # Clinical terminology
    body_system: str          # cardiac, neurological, respiratory, etc.
    is_life_threatening: bool
    onset: Optional[str]      # acute, gradual, unknown
```

**Claude structured output API call:**
```python
response = client.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=1024,
    system=TRIAGE_SYSTEM_PROMPT,
    messages=[{"role": "user", "content": transcript_text}],
    extra_headers={"anthropic-beta": "structured-outputs-2025-11-13"},
    output_format={
        "type": "json_schema",
        "json_schema": {
            "name": "triage_assessment",
            "schema": TriageAssessment.model_json_schema(),
            "strict": True,
        },
    },
)
result = TriageAssessment.model_validate_json(response.content[0].text)
```

### 1.3 Multi-Language Pipeline

```
Caller speaks Kannada → Sarvam Saaras v3 (STT, 22 langs, auto-detect)
    → Kannada text
    → Sarvam mayura:v1 (Translation)
    → English text (+ original preserved)
    → Claude Triage (structured output)
    → TriageAssessment JSON
```

**Key:** Send BOTH original language text AND English translation to Claude. Original preserves culturally specific terms (e.g., "seena dard" for chest pain).

### 1.4 System Prompt (Production)

The recommended system prompt includes:
- ESI Version 5 decision tree (step-by-step)
- India-specific medical context (snakebite, road traffic accidents, cardiac events in younger patients)
- Colloquial symptom mapping ("seena dard" → cardiac, "saanp ne kaata" → snakebite)
- Demographic inference ("ajji"/"thatha" → elderly, "bacha" → pediatric)
- Three few-shot examples (STEMI, snakebite, minor laceration)
- Chain-of-thought instructions
- "Undertriage kills, overtriage is safe" principle

### 1.5 Fallback Strategy

```
Tier 1: Claude API (structured output)     ← Primary (highest accuracy)
    ↓ (timeout 5s or API error)
Tier 2: Gemini 2.5 Flash (free tier)       ← Secondary (1000 req/day free)
    ↓ (timeout 5s or API error)
Tier 3: Local keyword matcher              ← Emergency fallback (no network)
    ↓
Tier 4: Human triage operator (phone)      ← Ultimate fallback
```

Uses `tenacity` (already in requirements.txt) for retry logic with exponential backoff.

### 1.6 Latency Targets

| Stage | Target | Notes |
|-------|--------|-------|
| Speech-to-text | < 2s | Sarvam WebSocket streaming |
| Translation | < 1s | Sarvam API |
| AI Triage (Claude) | < 3s | Structured output adds ~200ms first call, cached 24h |
| **Total pipeline** | **< 6s** | 20-50x faster than human nurse triage (2-5 min) |
| Keyword fallback | < 50ms | Pure local, no network |

### 1.7 OpenBioLLM-70B Self-Hosted (Long-term)

86.06% average across biomedical benchmarks (beats GPT-4, Med-PaLM-2 on several tasks).

| Component | Minimum | Production |
|-----------|---------|------------|
| GPU | 2x A100 80GB | 4x A100 80GB or 2x H100 |
| RAM | 64 GB | 128-256 GB |
| Serving | vLLM + AWQ 4-bit | vLLM + FP8 |
| Monthly cost | ~$6,000 (cloud) | $2,500 one-time (on-prem) |

**Breakeven:** ~30,000-50,000 API calls/day. Stay with Claude API until then.

---

## 2. Ambulance Dispatch

### 2.1 India's 108 System — No Public API Exists

108 operates through centralized state-level Emergency Response Centers (ERCs):

| Operator | States | Fleet |
|----------|--------|-------|
| **GVK EMRI** | 16+ states | ~10,000 ambulances |
| **Ziqitza (ZHL)** | MP, Odisha, Jharkhand, Punjab, Sikkim | ~3,022 ambulances |
| **BVG-UKSAS** | Maharashtra + others | Varies |

**Critical finding: No public API exists for 108/GVK EMRI/ZHL.** These are proprietary internal systems.

### 2.2 Realistic Integration Strategy

1. **Phone bridge**: Programmatically dial 108/112 via Twilio and relay caller information
2. **Private ambulance APIs**: Partner with RED.Health (StanPlus) or Medulance as primary dispatch — they offer enterprise SaaS models and are more open to tech integration
3. **Partnership model**: Approach GVK EMRI / ZHL for data-sharing MoUs
4. **Parallel dispatch**: Simultaneously trigger 108 + private ambulance + hospital notification

### 2.3 Private Ambulance Services (Higher Integration Potential)

| Company | Fleet | Integration Model |
|---------|-------|-------------------|
| **RED.Health (StanPlus)** | 450+ owned + 5,000 network | Enterprise SaaS, booking at booking.stanplus.com |
| **Medulance** | 7,500+ network | App-based, has CarDekho integration |
| **MedCab** | Network model | App-based, includes bed availability |
| **VMeDo** | Bangalore-focused | Web + app |

### 2.4 Emergency Number System

| Number | Purpose | Scope |
|--------|---------|-------|
| **108** | Emergency ambulance (ALS) | 35 states/UTs |
| **102** | Maternal transport (BLS) | Prenatal/postnatal |
| **112** | Unified emergency | 11 states fully live |
| **1298** | Private ambulance (ZHL) | Mumbai, Punjab, Bihar, Kerala |

### 2.5 Fleet Tracking APIs

**Recommended: MapMyIndia/Mappls InTouch** — India-specific, has explicit ambulance tracking use case.

| Platform | Strength | India Pricing |
|----------|----------|---------------|
| **Mappls InTouch** | India roads, ambulance use case, React Native SDK | Enterprise (contact sales) |
| **Google Routes API** | Traffic-aware ETA, generous India free tier | $1.50-4.50/1K requests |
| **HERE Fleet** | Advanced routing, toll calculation | Free tier: 250K tx/month |

**Google Maps limitation:** Not designed for emergency vehicle routing. No lights-and-sirens mode. Use for ETA calculations supplementally, not for primary dispatch routing.

---

## 3. Hospital Dispatch & Capability Matching

### 3.1 ABDM Health Facility Registry (HFR)

363,520 facilities registered. Data includes: bed capacity by type, specialty services, equipment, workforce, accreditation.

**API endpoints:**
- Sandbox: `https://facilitysbx.abdm.gov.in/swagger-ui.html`
- Production: `https://facility.abdm.gov.in/swagger-ui.html`
- Auth: `POST https://dev.abdm.gov.in/gateway/v0.5/sessions` → JWT token

**Limitation:** HFR is a registration registry, not real-time. Tells you what a hospital *has registered*, not what's *available now*.

### 3.2 Real-Time Bed Availability — No National System Exists

**What exists:**
- **NextGen eHospital (NIC)**: 1,575 hospitals, but no public API
- **COVID-era portals**: Mostly defunct
- **Individual hospital systems**: Internal, no public APIs

**Practical strategy:** Build a multi-source aggregation layer:
1. ABDM HFR for static capability data
2. Direct hospital partnerships for real-time bed data (start with 5-10 hospitals in Bangalore)
3. Manual seed data as fallback
4. Phone verification loop during dispatch (common practice in India today)

### 3.3 Hospital Matching Algorithm

Weighted scoring (100 points total):

| Factor | Weight | Logic |
|--------|--------|-------|
| Capability match | 40 pts | % of required capabilities present |
| Distance/ETA | 25 pts | Exponential decay (closer = higher) |
| Current load | 20 pts | Occupancy-based (< 70% = full score) |
| Specialty depth | 15 pts | Bonus for centers of excellence |

**No-perfect-match strategy:**
- **ESI-1/ESI-2**: Route to nearest partial match for stabilization → transfer to full-capability hospital
- **ESI-3+**: Route to full match even if farther

### 3.4 Hospital Pre-Notification Protocol

Pre-arrival alert to hospital ER with structured data:

```
GOLDEN HOUR PRE-ALERT
ESI-2 | ST-Elevation MI
ETA: 12min
Patient: elderly male
Need: cath_lab, icu, blood_bank
```

**Activation levels:**
- Level 1: Full trauma team activation (ESI-1) — SMS + voice call
- Level 2: Modified trauma response (ESI-2) — SMS + email
- Standard: ED notification only (ESI-3+) — SMS

Includes recommended preparations (e.g., "Activate cath lab team, prepare for emergent PCI").

---

## 4. Off-Duty Nurses Pager System

### 4.1 Concept — PulsePoint/GoodSAM for India

Modeled after PulsePoint (4,950+ US communities, 3M+ users) and GoodSAM (UK ambulance-integrated). **No equivalent exists in India** — this is greenfield.

When an ESI-1 or ESI-2 emergency is triaged, alert all qualified medical responders within configurable radius.

### 4.2 Database Schema (PostGIS)

```python
class Responder(Base):
    # Identity: full_name, phone_number, email
    # Professional: responder_type (nurse/doctor/paramedic/EMT),
    #   nursing_council_registration, employer, specialties
    # Location: current_location (PostGIS POINT), home_location
    # Availability: status (available/on_shift/off_duty_available/responding)
    # Notification: fcm_token, preferences (sms/push/voice)
    # Stats: total_responses, total_accepts, avg_response_time, rating

class Certification(Base):
    # GNM, BSC_NURSING, MSC_NURSING, ANM, BLS, ACLS, ATLS, PALS
    # issuing_body, certificate_number, expiry_date, is_verified
```

### 4.3 Geofenced Query — "All Available Nurses Within 5km"

PostGIS `ST_DWithin` query with GiST spatial index — typically < 10ms even with 100K+ responders:

```sql
SELECT r.*, ST_Distance(r.current_location, ST_MakePoint(lng, lat)::geography) AS distance_meters
FROM responders r
WHERE r.is_active AND r.is_verified
  AND r.availability_status IN ('available', 'off_duty_available')
  AND r.location_updated_at > NOW() - INTERVAL '30 minutes'
  AND ST_DWithin(r.current_location, ST_MakePoint(lng, lat)::geography, 5000)
ORDER BY distance_meters ASC
LIMIT 20
```

For ESI-1/ESI-2: expand radius to 10km and include on-shift nurses.

### 4.4 Multi-Channel Alert Cascade

```
Emergency Alert Triggered
    ├── Push Notification (FCM — fastest but unreliable on Indian Android OEMs)
    ├── SMS (Twilio — most reliable in India, DLT-compliant)
    ├── WhatsApp (high delivery rate in India)
    └── Voice Call (Twilio — ESI-1/ESI-2 only, overrides Do Not Disturb)

[If no response in 60s]
    └── Escalate to next on-call batch → repeat cascade
```

**India-specific:** Xiaomi, Realme, Vivo, OPPO aggressively kill background processes. SMS must always be sent as backup alongside push notifications. DLT registration mandatory for all SMS in India.

### 4.5 Notification Costs (India)

| Channel | Cost | Notes |
|---------|------|-------|
| FCM Push | Free | Unreliable on Indian Android OEMs |
| Twilio SMS | ~$0.0832/msg | DLT registration required |
| Twilio Voice | Pay-per-minute | For ESI-1/ESI-2 escalation |
| WhatsApp | Conversation-based | Highest adoption in India |

### 4.6 Acceptance Flow

1. Alert sent → responder receives via SMS/Push/Voice
2. Responder taps "Accept" (or replies "YES" to SMS)
3. System: update status to RESPONDING, activate GPS tracking
4. System: send patient info packet, calculate ETA
5. Responder arrives → ON_SCENE
6. Responder completes → log actions, return to AVAILABLE

**Timeouts by ESI level:** ESI-1: 30s, ESI-2: 30s, ESI-3: 60s, ESI-4: 120s, ESI-5: 300s

### 4.7 Alerting Platform Options

| Platform | Cost | Best For |
|----------|------|----------|
| **PagerDuty** (Free) | $0 (5 users) | Prototyping, on-call scheduling |
| **OnPage** | $14-29/user/mo | Production healthcare (HIPAA, EHR integration) |
| **Twilio** (DIY) | Pay-per-use | Custom build, most flexible |

### 4.8 India Nursing Landscape

- 3.07 million registered nurses (2022)
- State-level registration (Karnataka State Nursing Council, etc.)
- India's Good Samaritan Law (2016) protects bystanders who help accident victims
- No existing PulsePoint/GoodSAM equivalent in India

---

## 5. GPS Tracker for Family

### 5.1 React Native Implementation

**Core library:** `react-native-background-geolocation` (Transistorsoft) — most mature, battery-conscious background GPS library. Designed for fleet tracking and emergency response.

```
[Patient/Ambulance Phone] → GPS every 4-10 sec
    → WebSocket/Firebase → [Backend Server]
    → Fan out to family devices
    → [Family Phone] renders on map with ETA
```

### 5.2 Google Maps Platform APIs (India)

| API | Purpose | India Free Tier |
|-----|---------|-----------------|
| Routes API (Compute Routes) | Ambulance route + traffic ETA | 35K/month (Pro) |
| Routes API (Route Matrix) | Find nearest ambulance | 35K/month |
| Navigation SDK | Turn-by-turn for drivers | 1,000 destinations/month |
| Maps SDK | Map rendering for family | Standard |
| Roads API | Snap GPS to nearest road | Standard |

**India pricing:** Up to 70% discount vs. global. ~$6,800 USD free usage/month.

### 5.3 Mappls/MapMyIndia (India-Specific)

More accurate geocoding for Indian addresses. React Native SDKs available:
- `mapmyindia-map-react-native-beta` — Map rendering
- `mapmyindia-intouch-react-native-sdk` — Real-time tracking (designed for logistics/delivery)

**Recommendation:** Dual-provider strategy — Mappls for Indian address geocoding + local traffic ETA, Google Maps for map rendering + Navigation SDK.

### 5.4 Real-Time Data Layer

**Use both Firebase databases:**
- **Realtime Database**: Live GPS streaming (low latency, bandwidth-based pricing, `.onDisconnect()` for presence)
- **Firestore**: Session history, geospatial queries, status timeline events

### 5.5 ETA Calculation

**Google Routes API** with `routingPreference: "TRAFFIC_AWARE_OPTIMAL"` and `extraComputations: ["TRAFFIC_ON_POLYLINE"]` for traffic-colored route.

**Emergency vehicle correction factor** (based on [PMC study](https://pmc.ncbi.nlm.nih.gov/articles/PMC4288957/)):
- Google Maps ETA accurate within 5 min **76.9% of the time** for lights-and-sirens transport
- Apply 20-35% reduction factor for urban emergency runs
- City-specific: Bangalore 0.75, Mumbai 0.80 (very congested), Delhi 0.70 (green corridors)
- Time-of-day: peak 0.85, off-peak 0.65, night 0.55

**Long-term:** Build proprietary ETA model from actual ambulance GPS telemetry data.

### 5.6 Battery Optimization

| Phase | GPS Frequency | Strategy |
|-------|---------------|----------|
| Active emergency | Every 4 sec | Foreground service with notification |
| Ambulance en route | Every 10 sec | Sufficient for smooth map animation |
| Stationary/waiting | Geofencing | Only trigger on >50m movement |
| Post-emergency | Stopped | Immediately stop all tracking |

**India challenge:** Samsung, Xiaomi, OnePlus have aggressive battery optimization that kills background services. Test on real Indian OEM devices.

---

## 6. Live Status Updates & Family Anxiety Reduction

### 6.1 Technology Stack

| Technology | Direction | Best For |
|-----------|-----------|----------|
| **WebSocket** | Bidirectional | Live map, GPS streaming (app open) |
| **SSE** | Server-to-client | Status timeline updates (lighter) |
| **FCM** | Push | Notifications when app closed/background |

**Use all three:** WebSocket for live map, SSE for timeline, FCM for background push.

### 6.2 Emergency Status Timeline ("Pizza Tracker")

Based on [NN/g's 16 Design Guidelines for Status Trackers](https://www.nngroup.com/articles/status-tracker-progress-update/):

```
STAGE 1: CALL RECEIVED           ← Immediate
STAGE 2: TRIAGE COMPLETE          ← ~15-30 seconds
STAGE 3: AMBULANCE DISPATCHED     ← ~30-60 seconds
STAGE 4: AMBULANCE EN ROUTE       ← Live map + dynamic ETA every 30s
STAGE 5: AMBULANCE ARRIVED        ← FCM push to family
STAGE 6: PATIENT LOADED           ← EMT notes if available
STAGE 7: EN ROUTE TO HOSPITAL     ← Live map + hospital ETA
STAGE 8: ARRIVED AT HOSPITAL      ← ER contact + directions
STAGE 9: HANDOFF COMPLETE         ← Location sharing auto-expires
```

### 6.3 Academic Evidence on Anxiety Reduction

- **49.3% of family members** of ICU patients suffer clinical anxiety ([PMC meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC5407223/))
- Primary need: **information, support, and hope**
- Digital info tools reduced anxiety, stress, and maladaptive behaviors ([PMC pediatric study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7542856/))
- **Key insight:** The status timeline and live tracking are clinical anxiety interventions, not just features

### 6.4 Commercial UX Patterns

| Pattern | Source |
|---------|--------|
| Live dot on map (animated, 4-10s interpolation) | Uber |
| Dynamic ETA with countdown | Uber, DoorDash |
| Multi-step status bar (completed/active/pending) | Domino's, Amazon |
| Proactive push at each transition | All |
| Contact driver/EMT button | Uber |
| One-tap share tracking link | Uber |

### 6.5 Multi-Channel Family Notification

```
[Backend Event] → Redis Pub/Sub → [Notification Service]
                                       ├── FCM/APNs → Family with app
                                       ├── Twilio SMS → Family without app (tracking link)
                                       └── Twilio Voice → Elderly family (automated call)
```

### 6.6 Hospital Handoff

Once patient arrives at hospital, tracking transitions from ambulance tracking to in-hospital flow:
- If hospital has RTLS (CenTrak/Connexient): seamless handoff
- Fallback: Manual status updates from ER team
- Auto-expire location sharing 30 minutes after handoff

---

## 7. Privacy & Regulatory Compliance

### 7.1 DPDPA (Digital Personal Data Protection Act, 2023)

Partially effective Nov 13, 2025. Full enforcement by May 13, 2027.

**Critical emergency exception — Section 7(d):**
> Processing personal data without consent is permitted for "responding to a medical emergency involving a threat to the life or immediate threat to the health of the Data Principal."

**This means Golden Hour can legally process patient location and health data during an active emergency without explicit consent.**

However:
- Family members' data requires standard consent (they aren't in a medical emergency)
- Once emergency resolves, consent required for continued processing

### 7.2 Compliance Requirements

| Requirement | DPDPA Provision | Implementation |
|-------------|----------------|----------------|
| Notice | Section 5 | In-app data collection notice |
| Consent (non-emergency) | Section 6 | Opt-in for family location sharing |
| Emergency exception | Section 7(d) | No consent for patient during emergency |
| Retention limits | Section 8(7) | Auto-delete location data after emergency + grace |
| Breach reporting | Section 8(6) | Report to DPB within 72 hours |
| Right to erasure | Section 12 | User can delete emergency session data |

### 7.3 Location Sharing Consent Architecture

```
REGISTRATION: Family members pre-consent to receive location during emergencies
EMERGENCY: Patient location shared under Section 7(d) exception
           Pre-consented family → tracking link
           Non-consented family → SMS with consent required to open
POST-EMERGENCY: Auto-expire + patient notified + deletion available
```

### 7.4 Encryption

- Transport: WSS (WebSocket Secure) over TLS 1.3
- At rest: AES-256-GCM
- MVP: Transport-layer encryption sufficient (server needs location for ETA)
- Future: E2EE with X25519 key exchange + Double Ratchet (Signal Protocol)

### 7.5 Auto-Expiry

- Default: 2 hours after emergency initiated
- Extend: Reset to 1 hour after "arrived at hospital"
- Hard limit: 6 hours maximum
- Manual: Patient or family can stop anytime
- On resolution: 30 minutes after handoff complete
- Enforced via: Redis TTL + client timer + Firestore security rules

---

## 8. Recommended Architecture

### 8.1 Dispatch Pipeline Flow

```
Voice Input (Kannada/Hindi/Tamil/Telugu)
    → Sarvam Saaras v3 (STT, auto-detect language)
    → Sarvam mayura:v1 (Translate → English)
    → Claude Triage (structured output → TriageAssessment)
    → Parallel Dispatch (asyncio.gather):
        ├── 108 Ambulance (phone bridge via Twilio) ──── REDUNDANT
        ├── RED.Health/Medulance API ──────────────────── PRIMARY AMBULANCE
        ├── Hospital Pre-Notification (SMS + Voice) ───── CAPABILITY-MATCHED
        ├── Nurse Pager (PostGIS → FCM + SMS + Voice) ── NEAREST QUALIFIED
        ├── Family Notification (SMS tracking link) ───── ALL CONTACTS
        └── Bystander Guidance (CPR/first-aid protocol) ─ LANGUAGE-MATCHED
    → Dispatch State Machine (transitions library)
    → WebSocket updates → Family "Pizza Tracker"
    → Celery background tasks (monitoring, retries, escalation)
```

### 8.2 Technology Stack

```
Golden Hour Dispatch Layer
│
├── AMBULANCE DISPATCH (parallel)
│   ├── RED.Health / Medulance API (enterprise partnership) — PRIMARY
│   ├── 108 phone bridge via Twilio — REDUNDANT
│   └── Volunteer first responder alert via Firebase push
│
├── HOSPITAL MATCHING
│   ├── ABDM HFR API (static: specialties, beds, equipment)
│   ├── Custom hospital DB (seed data + partnerships for real-time beds)
│   └── PostGIS spatial queries (nearest with capabilities)
│
├── FLEET TRACKING
│   ├── Mappls InTouch SDK (primary — India-specific, ambulance use case)
│   └── Google Routes API (ETA calculations, generous India free tier)
│
├── STAFF ALERTING
│   ├── Twilio (SMS + Voice + WhatsApp) — multi-channel cascade
│   ├── Firebase FCM (push notifications — free)
│   └── PagerDuty free tier (on-call scheduling prototype)
│
├── FAMILY TRACKING
│   ├── react-native-background-geolocation (GPS)
│   ├── Firebase RTDB (live coordinate streaming)
│   ├── Firebase Firestore (session history, geospatial queries)
│   ├── Google Routes API (traffic-aware ETA)
│   └── Mappls (Indian address geocoding)
│
├── REAL-TIME UPDATES
│   ├── FastAPI WebSocket (live map, GPS streaming)
│   ├── Server-Sent Events (status timeline)
│   ├── FCM (background push notifications)
│   └── Redis Pub/Sub (message broker)
│
└── BACKGROUND TASKS
    ├── Celery + Redis (monitoring, retries, escalation)
    ├── Celery Beat (stale dispatch checks, hospital capacity polls)
    └── Post-emergency surveys and statistics
```

### 8.3 Database Models Needed

| Model | Purpose |
|-------|---------|
| `Hospital` | Capabilities, location (PostGIS), capacity, ABDM ID |
| `Responder` | Nurse/EMT profiles, location, availability, certifications |
| `Certification` | Professional certifications with verification status |
| `EmergencySession` | Transcript, triage result, dispatch state, timeline |
| `ResponseRecord` | Alert → accept/decline → arrival → actions audit trail |
| `DispatchLog` | Per-channel dispatch results with timestamps |

### 8.4 Key State Machine

```
initiated → dispatching → ambulance_acked → en_route → on_scene
                        → responder_acked          ↗
                        → hospital_acked
on_scene → transporting → at_hospital → resolved
dispatching → escalated (timeout, no response)
* → cancelled
```

### 8.5 Estimated Monthly Costs (Prototype)

| Service | Cost | Notes |
|---------|------|-------|
| Google Maps | Free | Within India free tier ($6,800/mo) |
| Twilio SMS (1,000 alerts) | ~$83 | DLT registration one-time |
| Twilio Voice (100 calls) | ~$10-50 | ESI-1/ESI-2 only |
| Firebase FCM | Free | Push notifications |
| PagerDuty | Free | 5 users |
| Mappls | TBD | Dev tier likely free |
| ABDM | Free | Government API |
| Claude API (~1,000 triage/day) | ~$100-150 | Structured output |

---

## 9. Implementation Roadmap

### Phase 1: Core Triage
- Wire Claude structured output in `src/backend/triage/router.py`
- Add multi-tier fallback (Gemini Flash, keyword matcher)
- Wire Sarvam AI STT + translation in `src/backend/speech/router.py`
- Update demo `vite-api-plugin.ts` to use structured outputs

### Phase 2: Database Models
- Create SQLAlchemy models (Hospital, Responder, Certification, EmergencySession, ResponseRecord)
- Run Alembic migrations
- Expand hospital seed data (Bangalore has only 2 hospitals)
- Build PostGIS spatial queries

### Phase 3: Hospital Matching + Dispatch
- Implement `HospitalMatcher` scoring algorithm
- Implement `HospitalPreNotification` service
- Build `DispatchOrchestrator` with `asyncio.gather` for parallel execution
- Add `DispatchSession` state machine using `transitions` library

### Phase 4: Responder Pager System
- Responder registration/onboarding API
- PostGIS `find_nearby_responders` query
- `ResponderAlertService` (SMS + FCM + Voice)
- Acceptance flow (accept/decline, GPS tracking, ETA)

### Phase 5: Real-Time + Family Tracking
- WebSocket endpoints for live dispatch tracking
- Celery + Redis for background monitoring
- Timeout/escalation logic
- Family notification multi-channel (FCM + SMS + Voice)
- Status timeline ("pizza tracker") implementation

### Phase 6: Self-Hosted AI (Scale)
- Deploy OpenBioLLM-70B on 2x A100 with vLLM (when >30K daily calls)
- A/B test against Claude API
- Maintain Claude as fallback

---

## 10. Sources

### AI Triage
- [ESI Handbook Fifth Edition](https://media.emscimprovement.center/documents/Emergency_Severity_Index_Handbook.pdf)
- [ChatGPT Emergency Triage — Scientific Reports 2024](https://www.nature.com/articles/s41598-024-73229-7)
- [LLM Emergency Triage — AJEM 2025](https://www.sciencedirect.com/science/article/abs/pii/S0735675724007071)
- [KATE NLP Triage System](https://www.jenonline.org/article/S0099-1767(20)30376-7/fulltext)
- [Claude Structured Outputs](https://docs.claude.com/en/docs/build-with-claude/structured-outputs)
- [Claude Prompt Engineering](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [OpenBioLLM-70B](https://huggingface.co/aaditya/Llama3-OpenBioLLM-70B)
- [Saama OpenBioLLM Announcement](https://www.saama.com/introducing-openbiollm-llama3-70b-8b-saamas-ai-research-lab-released-the-most-openly-available-medical-domain-llms-to-date/)
- [Sarvam AI STT](https://www.sarvam.ai/apis/speech-to-text/)
- [Sarvam AI Translation](https://docs.sarvam.ai/api-reference-docs/text/translate-text)

### Ambulance Dispatch
- [GVK EMRI](https://www.emri.in/108-emergency/)
- [GVK EMRI Wikipedia](https://en.wikipedia.org/wiki/GVK_EMRI)
- [Ziqitza Healthcare](https://zhl.org.in/)
- [ERSS 112 Official](https://112.gov.in/about)
- [RED.Health Enterprise](https://www.red.health/solutions/enterprise)
- [Medulance](https://medulance.com/)
- [108 vs 102 — RED.Health](https://www.red.health/blogs/difference-between-102-and-108-ambulance-services-in-india/)

### Fleet Tracking
- [Mappls API Portal](https://about.mappls.com/api/)
- [Mappls Developer Docs](https://developer.mappls.com/)
- [Google Routes API](https://developers.google.com/maps/documentation/routes)
- [Google India Pricing](https://developers.google.com/maps/billing-and-pricing/pricing-india)
- [HERE Fleet Telematics](https://www.here.com/docs/bundle/fleet-telematics-api-developer-guide/page/README.html)

### Hospital Dispatch
- [ABDM Sandbox](https://sandbox.abdm.gov.in/)
- [HFR Production Portal](https://facility.abdm.gov.in/)
- [ABDM Community Docs](https://kiranma72.github.io/abdm-docs/)
- [NextGen eHospital — NIC](https://www.nic.gov.in/project/nextgen-ehospital/)
- [Pre-hospital Notification Accuracy](https://www.sciencedirect.com/science/article/abs/pii/S0735675718305412)
- [Trauma Team Activation](https://med.uth.edu/surgery/trauma-and-ed-roles-and-responsibilities/)

### Nurse Pager
- [PulsePoint](https://www.pulsepoint.org/)
- [PulsePoint + GoodSAM Analysis](https://collective-intelligence.thegovlab.org/case/pulsepoint-and-goodsam)
- [PostGIS Geofencing](https://dzone.com/articles/how-to-do-simple-geofencing-with-postgis-1)
- [Geofencing at Scale](https://systemdr.substack.com/p/geofencing-at-scale-quadtrees-geohashes)
- [PagerDuty API](https://developer.pagerduty.com/api-reference)
- [OnPage Healthcare Paging](https://www.onpage.com/medical-paging-system/)
- [Twilio SMS India Pricing](https://www.twilio.com/en-us/sms/pricing/in)
- [FCM Android Delivery](https://firebase.blog/posts/2025/04/fcm-on-android/)

### GPS & Real-Time
- [react-native-background-geolocation](https://github.com/transistorsoft/react-native-background-geolocation)
- [Firebase RTDB vs Firestore](https://firebase.google.com/docs/database/rtdb-vs-firestore)
- [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/)
- [Routes API Compute Routes](https://developers.google.com/maps/documentation/routes/compute-route-over)
- [Ambulance ETA with GPS + Google Maps — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4288957/)
- [NextBillion.ai Ambulance Route Optimization](https://nextbillion.ai/blog/optimizing-ambulance-dispatch-routes-using-ai)

### Family Anxiety / UX
- [NN/g Status Trackers & Progress Updates](https://www.nngroup.com/articles/status-tracker-progress-update/)
- [NN/g Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/)
- [PMC: Family Anxiety in Critical Care](https://pmc.ncbi.nlm.nih.gov/articles/PMC5407223/)
- [PMC: Pediatric Hospital Information UX](https://pmc.ncbi.nlm.nih.gov/articles/PMC7542856/)
- [CenTrak RTLS](https://centrak.com/solutions)
- [UX Collective: Perfect Delivery Tracker](https://uxdesign.cc/the-perfect-delivery-tracker-is-about-saying-less-and-showing-more-68a12d9c4c82)

### Privacy
- [DPDPA Section 7 — Legitimate Uses](https://dpdpa.com/dpdpa2023/chapter-2/section7.html)
- [DPDPA Updated Guide — CookieYes](https://www.cookieyes.com/blog/india-digital-personal-data-protection-act-dpdpa/)
- [Deloitte DPDP Rules 2025](https://www.deloitte.com/in/en/services/consulting/about/indias-dpdp-rules-2025-leading-digital-privacy-compliance.html)
- [Grid E2EE Location Sharing](https://mygrid.app/)
