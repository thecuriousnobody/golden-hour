"""Speech Agent - Real-time multilingual transcription and location extraction."""

from crewai import Agent, Task


def create_speech_agent() -> Agent:
    return Agent(
        role="Emergency Speech Processor",
        goal="Transcribe emergency calls in any Indian language and extract location",
        backstory=(
            "You are an expert at understanding distressed speech in "
            "multiple Indian languages including code-switching. You extract key "
            "information even from panicked, unclear speech."
        ),
        verbose=True,
    )


def create_speech_task(agent: Agent) -> Task:
    return Task(
        description=(
            "Process incoming voice stream:\n"
            "1. Detect language (Hindi, Tamil, Telugu, Kannada, English, mixed)\n"
            "2. Transcribe in real-time with timestamps\n"
            "3. Extract location from voice + confirm with GPS\n"
            "4. Pass transcript to triage agent immediately"
        ),
        expected_output="Timestamped transcript with confirmed location",
        agent=agent,
    )
