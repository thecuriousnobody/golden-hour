"""AI Triage Engine — Claude API with structured output for emergency classification.

This is the core intelligence layer. Given an English transcript of an emergency call,
it extracts symptoms, classifies severity (ESI-aligned), determines required hospital
capabilities, and produces a structured triage assessment that drives dispatch.
"""

import json
import os
import logging

import anthropic
from pydantic import BaseModel, Field

logger = logging.getLogger("golden_hour.triage")

# ---------------------------------------------------------------------------
# Pydantic models for structured triage output
# ---------------------------------------------------------------------------

class ExtractedSymptom(BaseModel):
    key: str = Field(description="Category: Emergency, Symptom, Patient, Concern, Urgency")
    value: str = Field(description="Description of the symptom or finding")
    critical: bool = Field(description="True if this is life-threatening")


class TriageAssessment(BaseModel):
    symptoms: list[ExtractedSymptom] = Field(description="Extracted medical symptoms")
    likely_condition: str = Field(description="Most likely medical condition")
    severity: str = Field(description="CRITICAL, HIGH, MODERATE, or LOW")
    esi_level: int = Field(ge=1, le=5, description="ESI triage level (1=most urgent, 5=least)")
    triage_score: int = Field(ge=1, le=10, description="Triage score (1=minor, 10=life-threatening)")
    required_capabilities: list[str] = Field(description="Hospital capabilities needed (e.g. cath_lab, trauma_center, icu)")
    reasoning: str = Field(description="Brief clinical reasoning (1-2 sentences)")
    time_criticality_minutes: int = Field(description="Estimated time window for intervention in minutes")
    patient_demographics: str = Field(default="unknown", description="Age/gender if discernible from context")


# ---------------------------------------------------------------------------
# System prompt — medical triage specialist
# ---------------------------------------------------------------------------

TRIAGE_SYSTEM_PROMPT = """You are a medical triage AI for an emergency response system in India.

You receive English translations of emergency calls (originally in Kannada, Hindi, Tamil, Telugu, or other Indian languages).

Your job:
1. Extract medical symptoms from colloquial/everyday language
2. Infer the likely medical condition
3. Classify severity using the Emergency Severity Index (ESI):
   - ESI-1: Immediate life-threatening (cardiac arrest, not breathing, massive hemorrhage)
   - ESI-2: High risk / altered mental status / severe pain (stroke, chest pain, major trauma)
   - ESI-3: Multiple resources needed (fracture + laceration, moderate burns)
   - ESI-4: One resource needed (simple laceration, minor sprain)
   - ESI-5: No resources needed (cold symptoms, minor rash)
4. Determine what hospital capabilities are required
5. Estimate time criticality (how many minutes before intervention is needed)

Map everyday descriptions to medical terminology:
- "face drooping on one side" → stroke symptoms (ESI-1/2)
- "grabbed his chest and fell down" → cardiac event (ESI-1)
- "not able to move legs" → possible spinal injury (ESI-2)
- "bleeding from head" → head trauma (ESI-2)
- "high fever and shaking" → possible seizure/febrile convulsion (ESI-2)
- "fell from height" → trauma/fractures (ESI-2/3)
- "ate something and vomiting" → poisoning (ESI-2/3)
- "snake bit" → snakebite envenomation (ESI-2)
- "burning/burns" → burn injury (ESI-2/3)
- "not breathing" → respiratory arrest (ESI-1)
- "unconscious" / "not responding" → altered consciousness (ESI-1)

Extract patient demographics from context clues:
- "grandfather", "old man" → elderly male
- "child", "baby", "little one" → pediatric
- "pregnant", "expecting" → obstetric emergency

Required hospital capabilities (pick all that apply):
- cath_lab: cardiac catheterization (heart attacks)
- ct_scan: CT imaging (stroke, head trauma)
- trauma_center: major trauma care
- burn_unit: burn treatment
- icu: intensive care
- ventilator: respiratory support
- pediatric: children's care
- obstetric: pregnancy/delivery
- neurosurgery: brain/spine surgery
- orthopedic: bone/joint surgery
- dialysis: kidney support
- antivenom: snakebite treatment
- nicu: neonatal intensive care
- blood_bank: transfusion services
- stroke_unit: stroke treatment

IMPORTANT: You are a Clinical Decision Support tool, NOT a diagnostic system.
Include this disclaimer in your reasoning: "AI-assisted triage — not a medical diagnosis."

Respond ONLY with valid JSON matching the exact schema provided."""


# ---------------------------------------------------------------------------
# Keyword-based fallback (no API needed)
# ---------------------------------------------------------------------------

KEYWORD_RULES = [
    # (keywords, condition, severity, esi, score, capabilities, time_minutes)
    (["not breathing", "stopped breathing", "no pulse", "cardiac arrest"],
     "Cardiac/Respiratory Arrest", "CRITICAL", 1, 10, ["icu", "ventilator", "cath_lab"], 5),
    (["chest pain", "heart attack", "chest tightness", "grabbed chest", "holding his chest", "holding her chest", "clutching chest"],
     "Suspected Cardiac Event", "CRITICAL", 1, 9, ["cath_lab", "icu"], 15),
    (["stroke", "face drooping", "face is drooping", "slurred speech", "cannot speak", "one side weak", "one side numb", "paralysis", "arm is weak", "arm is numb"],
     "Suspected Stroke", "CRITICAL", 1, 9, ["stroke_unit", "ct_scan", "icu"], 30),
    (["unconscious", "not responding", "fainted", "collapsed", "passed out"],
     "Altered Consciousness", "CRITICAL", 2, 8, ["icu", "ct_scan"], 15),
    (["heavy bleeding", "blood everywhere", "hemorrhage", "bleeding badly"],
     "Major Hemorrhage", "CRITICAL", 1, 9, ["trauma_center", "blood_bank", "icu"], 10),
    (["snake bit", "snake bite", "snakebite"],
     "Snakebite Envenomation", "HIGH", 2, 7, ["antivenom", "icu"], 30),
    (["burn", "burning", "scalded", "fire"],
     "Burn Injury", "HIGH", 2, 7, ["burn_unit", "icu"], 30),
    (["fell from", "fall from height", "accident", "crash", "collision"],
     "Trauma / Fall", "HIGH", 2, 7, ["trauma_center", "ct_scan", "orthopedic"], 30),
    (["head injury", "head bleeding", "hit head"],
     "Head Trauma", "HIGH", 2, 8, ["ct_scan", "neurosurgery", "icu"], 20),
    (["pregnant", "labor", "delivering", "water broke", "contractions"],
     "Obstetric Emergency", "HIGH", 2, 7, ["obstetric", "nicu"], 30),
    (["child", "baby", "infant", "kid", "toddler"],
     "Pediatric Emergency", "HIGH", 2, 7, ["pediatric"], 30),
    (["breathing difficulty", "can't breathe", "asthma", "wheezing", "choking"],
     "Respiratory Distress", "HIGH", 2, 8, ["icu", "ventilator"], 15),
    (["poison", "poisoning", "vomiting", "ate something"],
     "Suspected Poisoning", "HIGH", 2, 7, ["icu"], 30),
    (["fracture", "broken bone", "broken leg", "broken arm"],
     "Fracture", "MODERATE", 3, 5, ["orthopedic"], 60),
    (["fever", "high temperature", "shaking", "seizure", "convulsion"],
     "Febrile Illness / Seizure", "HIGH", 2, 6, ["icu", "pediatric"], 30),
    (["cut", "laceration", "wound", "bleeding"],
     "Laceration / Wound", "MODERATE", 3, 4, ["trauma_center"], 60),
]


def _keyword_fallback(transcript: str) -> TriageAssessment:
    """Rule-based triage when Claude API is unavailable.

    Scans ALL rules and picks the one with the highest triage score,
    merging capabilities from all matching rules.
    """
    text_lower = transcript.lower()

    best_match = None
    best_score = 0
    all_capabilities: set[str] = set()
    all_matched_keywords: list[str] = []

    for keywords, condition, severity, esi, score, capabilities, time_min in KEYWORD_RULES:
        for kw in keywords:
            if kw in text_lower:
                all_capabilities.update(capabilities)
                all_matched_keywords.append(kw)
                if score > best_score:
                    best_match = (keywords, condition, severity, esi, score, capabilities, time_min)
                    best_score = score
                break  # Only match first keyword per rule

    if best_match:
        keywords, condition, severity, esi, score, capabilities, time_min = best_match
        symptoms = [
            ExtractedSymptom(key="Emergency", value=condition, critical=esi <= 2),
        ]
        for kw in all_matched_keywords:
            symptoms.append(ExtractedSymptom(key="Symptom", value=f"Keyword match: '{kw}'", critical=False))

        return TriageAssessment(
            symptoms=symptoms,
            likely_condition=condition,
            severity=severity,
            esi_level=esi,
            triage_score=score,
            required_capabilities=sorted(all_capabilities),
            reasoning=f"Keyword-based fallback triage. Matched: {', '.join(all_matched_keywords)}. AI-assisted triage — not a medical diagnosis.",
            time_criticality_minutes=time_min,
            patient_demographics="unknown",
        )

    # Nothing matched — return a generic moderate assessment
    return TriageAssessment(
        symptoms=[ExtractedSymptom(key="Concern", value="Unclassified emergency", critical=False)],
        likely_condition="Unclassified Emergency",
        severity="MODERATE",
        esi_level=3,
        triage_score=5,
        required_capabilities=["icu"],
        reasoning="No specific symptoms matched. Defaulting to moderate severity. AI-assisted triage — not a medical diagnosis.",
        time_criticality_minutes=30,
        patient_demographics="unknown",
    )


# ---------------------------------------------------------------------------
# Main triage function — Claude API with keyword fallback
# ---------------------------------------------------------------------------

async def run_triage(transcript: str, language: str = "en") -> TriageAssessment:
    """Run AI triage on an emergency transcript.

    Uses Claude API for intelligent symptom extraction and ESI classification.
    Falls back to keyword matching if API is unavailable.

    Args:
        transcript: English text of the emergency call (already translated if needed).
        language: Original language code (e.g. 'kn' for Kannada, 'hi' for Hindi).

    Returns:
        TriageAssessment with symptoms, severity, required capabilities, etc.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")

    if not api_key or api_key.startswith("your_"):
        logger.warning("No ANTHROPIC_API_KEY configured — using keyword fallback")
        return _keyword_fallback(transcript)

    try:
        client = anthropic.AsyncAnthropic(api_key=api_key)

        user_message = f"Emergency call transcript (English translation from {language}):\n\"{transcript}\""

        # Use Claude with explicit JSON schema instructions
        response = await client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=1024,
            system=TRIAGE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        text_block = next((b for b in response.content if b.type == "text"), None)
        if not text_block:
            raise ValueError("No text in Claude response")

        # Parse — strip markdown fences if present
        json_text = text_block.text.strip()
        if json_text.startswith("```"):
            json_text = json_text.split("\n", 1)[1] if "\n" in json_text else json_text[3:]
            if json_text.endswith("```"):
                json_text = json_text[:-3].strip()

        raw = json.loads(json_text)

        # Map from Claude's camelCase output to our snake_case model
        return TriageAssessment(
            symptoms=[ExtractedSymptom(**s) for s in raw.get("symptoms", [])],
            likely_condition=raw.get("likelyCondition", raw.get("likely_condition", "Unknown")),
            severity=raw.get("severity", "MODERATE"),
            esi_level=raw.get("esiLevel", raw.get("esi_level", 3)),
            triage_score=raw.get("triageScore", raw.get("triage_score", 5)),
            required_capabilities=raw.get("requiredCapabilities", raw.get("required_capabilities", [])),
            reasoning=raw.get("reasoning", ""),
            time_criticality_minutes=raw.get("timeCriticalityMinutes", raw.get("time_criticality_minutes", 30)),
            patient_demographics=raw.get("patientDemographics", raw.get("patient_demographics", "unknown")),
        )

    except Exception as e:
        logger.error("Claude triage failed, falling back to keywords: %s", e)
        return _keyword_fallback(transcript)
