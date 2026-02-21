"""Hospital Capability Matching Engine.

Matches triage requirements to the nearest hospital with the right capabilities.
Uses Haversine distance for now (no PostGIS dependency needed for prototype).
In production, this would use PostGIS ST_DWithin for spatial index queries
and real-time bed availability from ABDM Health Facility Registry.
"""

import json
import math
import logging
from pathlib import Path
from dataclasses import dataclass, field

logger = logging.getLogger("golden_hour.hospital_matcher")

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class Hospital:
    id: str
    name: str
    city: str
    capabilities: list[str]
    address: str
    lat: float
    lng: float
    emergency_contact: str
    whatsapp_number: str = ""  # For WhatsApp dispatch
    verified: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> "Hospital":
        loc = data.get("location", {})
        return cls(
            id=data["id"],
            name=data["name"],
            city=data.get("city", ""),
            capabilities=data.get("capabilities", []),
            address=data.get("address", ""),
            lat=loc.get("lat", 0.0),
            lng=loc.get("lng", 0.0),
            emergency_contact=data.get("emergency_contact", ""),
            whatsapp_number=data.get("whatsapp_number", data.get("emergency_contact", "")),
            verified=data.get("verified", False),
        )


@dataclass
class HospitalMatch:
    hospital: Hospital
    distance_km: float
    capability_score: float  # 0.0 to 1.0 — what fraction of required capabilities are met
    overall_score: float     # Weighted combination of distance + capability
    missing_capabilities: list[str] = field(default_factory=list)
    matched_capabilities: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Haversine distance
# ---------------------------------------------------------------------------

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate great-circle distance between two points in km."""
    R = 6371.0  # Earth radius in km
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Hospital registry (in-memory, loaded from seed JSON)
# ---------------------------------------------------------------------------

_hospitals: list[Hospital] = []


def load_hospitals(json_path: str | None = None) -> list[Hospital]:
    """Load hospital data from JSON seed file."""
    global _hospitals

    if json_path is None:
        json_path = str(Path(__file__).parent.parent.parent.parent / "data" / "hospitals" / "bangalore.json")

    try:
        with open(json_path) as f:
            data = json.load(f)
        _hospitals = [Hospital.from_dict(h) for h in data]
        logger.info("Loaded %d hospitals from %s", len(_hospitals), json_path)
    except FileNotFoundError:
        logger.warning("Hospital data not found at %s — using empty registry", json_path)
        _hospitals = []

    return _hospitals


def get_hospitals() -> list[Hospital]:
    """Get currently loaded hospitals."""
    if not _hospitals:
        load_hospitals()
    return _hospitals


# ---------------------------------------------------------------------------
# Capability matching algorithm
# ---------------------------------------------------------------------------

# Weights for scoring
CAPABILITY_WEIGHT = 0.7   # Capability match is most important
DISTANCE_WEIGHT = 0.3     # Distance matters but less than having the right equipment
MAX_DISTANCE_KM = 50.0    # Normalize distances against this max


def match_hospitals(
    required_capabilities: list[str],
    caller_lat: float,
    caller_lng: float,
    max_results: int = 5,
    max_distance_km: float = 50.0,
) -> list[HospitalMatch]:
    """Find best hospitals matching required capabilities, ranked by score.

    Scoring algorithm:
    - capability_score: fraction of required capabilities the hospital has (0-1)
    - distance_score: 1 - (distance / max_distance), clamped to 0 (closer = higher)
    - overall_score: CAPABILITY_WEIGHT * capability_score + DISTANCE_WEIGHT * distance_score

    This means a hospital 20km away with a cath_lab will rank higher than
    a hospital 2km away without one, for a cardiac emergency.
    """
    hospitals = get_hospitals()
    if not hospitals:
        logger.warning("No hospitals loaded — cannot match")
        return []

    matches: list[HospitalMatch] = []

    for h in hospitals:
        distance = haversine_km(caller_lat, caller_lng, h.lat, h.lng)

        if distance > max_distance_km:
            continue

        # Capability scoring
        if required_capabilities:
            matched = [c for c in required_capabilities if c in h.capabilities]
            missing = [c for c in required_capabilities if c not in h.capabilities]
            cap_score = len(matched) / len(required_capabilities)
        else:
            matched, missing = [], []
            cap_score = 1.0  # No specific requirements → any hospital matches

        # Distance scoring (closer = higher)
        dist_score = max(0.0, 1.0 - (distance / MAX_DISTANCE_KM))

        # Combined score
        overall = CAPABILITY_WEIGHT * cap_score + DISTANCE_WEIGHT * dist_score

        matches.append(HospitalMatch(
            hospital=h,
            distance_km=round(distance, 2),
            capability_score=round(cap_score, 3),
            overall_score=round(overall, 3),
            missing_capabilities=missing,
            matched_capabilities=matched,
        ))

    # Sort by overall score descending, then by distance ascending
    matches.sort(key=lambda m: (-m.overall_score, m.distance_km))

    return matches[:max_results]


def get_best_hospital(
    required_capabilities: list[str],
    caller_lat: float,
    caller_lng: float,
) -> HospitalMatch | None:
    """Get the single best matching hospital."""
    matches = match_hospitals(required_capabilities, caller_lat, caller_lng, max_results=1)
    return matches[0] if matches else None
