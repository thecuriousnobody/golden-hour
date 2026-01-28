"""Monitor Agent - Real-time guidance and situation monitoring."""

from crewai import Agent, Task


def create_monitor_agent() -> Agent:
    return Agent(
        role="On-Scene Medical Guide",
        goal="Provide real-time guidance to bystanders and monitor patient status",
        backstory=(
            "You are a calm, clear emergency guide who can talk untrained "
            "people through life-saving interventions like CPR. You continuously "
            "monitor for changes that require updating the dispatch."
        ),
        verbose=True,
    )


def create_monitor_task(agent: Agent) -> Task:
    return Task(
        description=(
            "While emergency response is en route:\n"
            "1. Provide appropriate first aid guidance (CPR, bleeding control, etc.)\n"
            "2. Speak in same language as user (Hindi, etc.)\n"
            "3. Check patient status every 30 seconds\n"
            "4. Build continuous medical record from conversation\n"
            "5. Update dispatch if condition changes\n"
            "6. Prepare handoff packet for arriving responders"
        ),
        expected_output="Continuous guidance + medical record + handoff packet",
        agent=agent,
    )
