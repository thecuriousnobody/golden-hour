"""Golden Hour - CrewAI Agent Orchestration"""

from crewai import Crew, Process

from src.agents.transcription_agent import create_speech_agent, create_speech_task
from src.agents.triage_agent import create_triage_agent, create_triage_task
from src.agents.dispatch_agent import create_dispatch_agent, create_dispatch_task
from src.agents.monitoring_agent import create_monitor_agent, create_monitor_task


def create_golden_hour_crew() -> Crew:
    """Create the Golden Hour emergency response crew."""
    speech_agent = create_speech_agent()
    triage_agent = create_triage_agent()
    dispatch_agent = create_dispatch_agent()
    monitor_agent = create_monitor_agent()

    return Crew(
        agents=[speech_agent, triage_agent, dispatch_agent, monitor_agent],
        tasks=[
            create_speech_task(speech_agent),
            create_triage_task(triage_agent),
            create_dispatch_task(dispatch_agent),
            create_monitor_task(monitor_agent),
        ],
        process=Process.sequential,
        verbose=True,
    )


if __name__ == "__main__":
    crew = create_golden_hour_crew()
    print("Golden Hour Crew initialized successfully.")
    print(f"Agents: {[a.role for a in crew.agents]}")
