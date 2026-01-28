"""Quick test script for the triage classification engine."""

import asyncio
import json


SAMPLE_TRANSCRIPTS = [
    {
        "language": "English",
        "text": "My father collapsed, he's holding his chest, he's sweating, he can't breathe",
        "expected": "cardiac",
    },
    {
        "language": "Hinglish",
        "text": "Papa gir gaye, seena pakad rahe hain, bahut paseena aa raha hai",
        "expected": "cardiac",
    },
    {
        "language": "English",
        "text": "Accident ho gaya, bike wala gir gaya, sar se khoon nikal raha hai",
        "expected": "trauma",
    },
]


async def test_classification(transcript: dict) -> None:
    """Test triage classification for a sample transcript."""
    print(f"\n--- [{transcript['language']}] ---")
    print(f"Input: {transcript['text']}")
    print(f"Expected: {transcript['expected']}")
    # TODO: Call actual triage classifier
    print("Result: (not yet implemented)")


async def main():
    print("Golden Hour - Triage Classification Test")
    print("=" * 50)

    for transcript in SAMPLE_TRANSCRIPTS:
        await test_classification(transcript)


if __name__ == "__main__":
    asyncio.run(main())
