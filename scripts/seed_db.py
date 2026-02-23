"""Seed database with hospital and responder data from JSON files.

Usage:
    python -m scripts.seed_db

Requires DATABASE_URL to be set. Skips gracefully if DB is not available.
"""

import asyncio
import json
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv()

from src.backend.db.base import engine, async_session_factory  # noqa: E402
from src.backend.db.models import Hospital, Responder  # noqa: E402


DATA_DIR = Path(__file__).parent.parent / "data"


async def seed_hospitals():
    """Load hospitals from JSON into database."""
    path = DATA_DIR / "hospitals" / "bangalore.json"
    if not path.exists():
        print(f"Hospital data not found at {path}")
        return 0

    with open(path) as f:
        hospitals = json.load(f)

    async with async_session_factory() as session:
        count = 0
        for h in hospitals:
            loc = h.get("location", {})
            hospital = Hospital(
                name=h["name"],
                city=h.get("city", "Bangalore"),
                address=h.get("address", ""),
                capabilities=h.get("capabilities", []),
                lat=loc.get("lat", 0.0),
                lng=loc.get("lng", 0.0),
                emergency_contact=h.get("emergency_contact", ""),
                whatsapp_number=h.get("whatsapp_number", h.get("emergency_contact", "")),
                verified=h.get("verified", False),
            )
            session.add(hospital)
            count += 1
        await session.commit()
        print(f"Seeded {count} hospitals")
        return count


async def seed_responders():
    """Load nurses and ambulance crews from JSON into database."""
    count = 0

    # Nurses
    nurses_path = DATA_DIR / "responders" / "bangalore_nurses.json"
    if nurses_path.exists():
        with open(nurses_path) as f:
            nurses = json.load(f)

        async with async_session_factory() as session:
            for n in nurses:
                loc = n.get("location", {})
                responder = Responder(
                    name=n["name"],
                    role="nurse",
                    qualification=n.get("qualification", ""),
                    specialization=n.get("specialization", ""),
                    languages=n.get("languages", []),
                    phone=n.get("whatsapp_number", ""),
                    whatsapp_number=n.get("whatsapp_number", ""),
                    lat=loc.get("lat", 0.0),
                    lng=loc.get("lng", 0.0),
                    radius_km=n.get("radius_km", 5.0),
                    available=n.get("available", True),
                )
                session.add(responder)
                count += 1
            await session.commit()

    print(f"Seeded {count} responders")
    return count


async def main():
    if engine is None:
        print("DATABASE_URL not set — skipping seed")
        return

    print("Seeding database...")
    await seed_hospitals()
    await seed_responders()
    print("Done!")


if __name__ == "__main__":
    asyncio.run(main())
