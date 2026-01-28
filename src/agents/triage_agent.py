"""Triage Agent - Medical symptom extraction and severity classification."""

from crewai import Agent, Task


def create_triage_agent() -> Agent:
    return Agent(
        role="Emergency Medical Triage",
        goal="Classify emergency type and severity from transcript",
        backstory=(
            "You are a trained emergency medicine specialist who can "
            "identify life-threatening conditions from symptom descriptions. You "
            "work under pressure and make rapid, accurate classifications."
        ),
        llm="claude-sonnet-4-5-20250929",
        verbose=True,
    )


def create_triage_task(agent: Agent) -> Task:
    return Task(
        description=(
            "From the speech transcript:\n"
            "1. Extract symptoms (chest pain, bleeding, unconscious, etc.)\n"
            "2. Classify emergency type with confidence score\n"
            "3. Determine required facility capabilities (cath lab, trauma center, etc.)\n"
            "4. Identify nearest appropriate facilities (not just nearest)\n"
            "5. Estimate time criticality\n\n"
            "Output structured triage assessment."
        ),
        expected_output=(
            '{"symptoms": [...], "classification": "...", "confidence": 0.0, '
            '"severity": "...", "required_capability": "...", "recommended_facilities": [...]}'
        ),
        agent=agent,
    )
