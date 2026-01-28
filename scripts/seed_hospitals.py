"""Seed hospital capability database from JSON files."""

import json
import os
from pathlib import Path


def load_hospitals(data_dir: str = "data/hospitals") -> list[dict]:
    """Load all hospital records from JSON files."""
    hospitals = []
    data_path = Path(data_dir)

    for json_file in data_path.glob("*.json"):
        with open(json_file) as f:
            city_hospitals = json.load(f)
            hospitals.extend(city_hospitals)

    return hospitals


def seed_database(hospitals: list[dict]) -> None:
    """Insert hospital records into database."""
    # TODO: Implement database insertion via SQLAlchemy
    for hospital in hospitals:
        print(f"  [{hospital['city']}] {hospital['name']} - {hospital['capabilities']}")


if __name__ == "__main__":
    hospitals = load_hospitals()
    print(f"Loaded {len(hospitals)} hospitals:")
    seed_database(hospitals)
