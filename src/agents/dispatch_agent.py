"""Dispatch Agent - Parallel multi-channel dispatch orchestration."""

from crewai import Agent, Task


def create_dispatch_agent() -> Agent:
    return Agent(
        role="Emergency Dispatch Coordinator",
        goal="Activate all emergency response channels simultaneously",
        backstory=(
            "You coordinate emergency response across multiple channels. "
            "You understand that in India, the official system often fails, so you "
            "activate backup channels in parallel rather than waiting."
        ),
        verbose=True,
    )


def create_dispatch_task(agent: Agent) -> Task:
    return Task(
        description=(
            "Given triage assessment, dispatch IN PARALLEL (not sequential):\n"
            "1. Send structured alert to 108 ambulance service\n"
            "2. Notify recommended hospital with patient packet\n"
            "3. Alert registered first responders within 1km radius\n"
            "4. Send location sharing SMS to emergency contacts\n\n"
            "Track acknowledgments from each channel.\n"
            "Do not wait for 108 to respond before activating other channels."
        ),
        expected_output="Dispatch confirmation with acknowledgment status per channel",
        agent=agent,
    )
