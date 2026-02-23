"""Dispatch State Machine — tracks emergency session lifecycle.

Uses the `transitions` library for a formal state machine with:
- 11 states covering the full dispatch lifecycle
- Timeline recording on every state change
- 9-stage "pizza tracker" mapping for frontend display

States:
    initiated -> triaging -> dispatching -> ambulance_acked -> en_route ->
    on_scene -> transporting -> at_hospital -> resolved
    (+ escalated, cancelled from any state)
"""

import logging
from datetime import datetime, timezone
from dataclasses import dataclass, field

try:
    from transitions import Machine
    HAS_TRANSITIONS = True
except ImportError:
    HAS_TRANSITIONS = False

logger = logging.getLogger("golden_hour.state_machine")


# All valid states
STATES = [
    "initiated",
    "triaging",
    "dispatching",
    "ambulance_acked",
    "en_route",
    "on_scene",
    "transporting",
    "at_hospital",
    "resolved",
    "escalated",
    "cancelled",
]

# State transitions
TRANSITIONS = [
    {"trigger": "start_triage", "source": "initiated", "dest": "triaging"},
    {"trigger": "start_dispatch", "source": "triaging", "dest": "dispatching"},
    {"trigger": "ambulance_acknowledge", "source": "dispatching", "dest": "ambulance_acked"},
    {"trigger": "ambulance_depart", "source": "ambulance_acked", "dest": "en_route"},
    {"trigger": "arrive_on_scene", "source": "en_route", "dest": "on_scene"},
    {"trigger": "begin_transport", "source": "on_scene", "dest": "transporting"},
    {"trigger": "arrive_at_hospital", "source": "transporting", "dest": "at_hospital"},
    {"trigger": "resolve", "source": "at_hospital", "dest": "resolved"},
    # Escalation — from dispatching or ambulance_acked
    {"trigger": "escalate", "source": "dispatching", "dest": "escalated"},
    {"trigger": "escalate", "source": "ambulance_acked", "dest": "escalated"},
    # Cancellation — from any non-terminal state
    {"trigger": "cancel", "source": "initiated", "dest": "cancelled"},
    {"trigger": "cancel", "source": "triaging", "dest": "cancelled"},
    {"trigger": "cancel", "source": "dispatching", "dest": "cancelled"},
    {"trigger": "cancel", "source": "ambulance_acked", "dest": "cancelled"},
    {"trigger": "cancel", "source": "en_route", "dest": "cancelled"},
    {"trigger": "cancel", "source": "on_scene", "dest": "cancelled"},
    # Re-dispatch after escalation
    {"trigger": "start_dispatch", "source": "escalated", "dest": "dispatching"},
    # Direct resolve from other states (e.g. false alarm)
    {"trigger": "resolve", "source": "on_scene", "dest": "resolved"},
    {"trigger": "resolve", "source": "dispatching", "dest": "resolved"},
]

# Pizza tracker: map states to 9 progress stages (1-indexed)
TRACKER_STAGES = {
    "initiated": 1,
    "triaging": 2,
    "dispatching": 3,
    "ambulance_acked": 4,
    "en_route": 5,
    "on_scene": 6,
    "transporting": 7,
    "at_hospital": 8,
    "resolved": 9,
    "escalated": 3,  # Back to dispatch level
    "cancelled": 0,
}

TRACKER_LABELS = {
    1: "Emergency Reported",
    2: "Assessing Severity",
    3: "Dispatching Help",
    4: "Ambulance Confirmed",
    5: "Ambulance En Route",
    6: "Help Arrived",
    7: "Transporting to Hospital",
    8: "At Hospital",
    9: "Resolved",
    0: "Cancelled",
}


@dataclass
class TimelineEntry:
    """A single entry in the session timeline."""
    state: str
    timestamp: str
    tracker_stage: int
    tracker_label: str
    metadata: dict = field(default_factory=dict)


class DispatchSession:
    """State machine for a single emergency dispatch session.

    Usage:
        session = DispatchSession("gh_abc123")
        session.start_triage()
        session.start_dispatch()
        session.ambulance_acknowledge(metadata={"ambulance_id": "amb_001"})
        print(session.timeline)  # Full state history
        print(session.tracker_stage)  # Current pizza tracker position
    """

    def __init__(self, session_id: str, initial_state: str = "initiated"):
        self.session_id = session_id
        self.timeline: list[dict] = []
        self._state = initial_state

        if HAS_TRANSITIONS:
            self.machine = Machine(
                model=self,
                states=STATES,
                transitions=TRANSITIONS,
                initial=initial_state,
                after_state_change="on_state_change",
            )
        else:
            # Minimal fallback without transitions library
            self.state = initial_state

        # Record initial state
        self._record_timeline(initial_state)

    def on_state_change(self, **kwargs):
        """Called after every state transition by the transitions library."""
        metadata = kwargs.get("metadata", {})
        self._record_timeline(self.state, metadata)
        # Publish to Redis (non-blocking, fire-and-forget)
        self._publish_state_change()

    def _record_timeline(self, state: str, metadata: dict | None = None):
        """Add a timeline entry for the current state."""
        stage = TRACKER_STAGES.get(state, 0)
        entry = {
            "state": state,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "tracker_stage": stage,
            "tracker_label": TRACKER_LABELS.get(stage, "Unknown"),
            "metadata": metadata or {},
        }
        self.timeline.append(entry)
        logger.info(
            "Session %s: %s (stage %d: %s)",
            self.session_id, state, stage, TRACKER_LABELS.get(stage, ""),
        )

    def _publish_state_change(self):
        """Publish state change to Redis pub/sub (best-effort)."""
        try:
            import asyncio
            from src.backend.realtime.pubsub import publish_event
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(publish_event(
                    self.session_id,
                    "state_change",
                    {"state": self.state, "timeline": self.timeline},
                ))
        except Exception:
            pass  # Non-blocking: don't fail dispatch if Redis is down

    @property
    def tracker_stage(self) -> int:
        """Current pizza tracker stage number (1-9, 0 for cancelled)."""
        return TRACKER_STAGES.get(self.state, 0)

    @property
    def tracker_label(self) -> str:
        """Current pizza tracker label."""
        return TRACKER_LABELS.get(self.tracker_stage, "Unknown")

    @property
    def is_terminal(self) -> bool:
        """Whether the session is in a terminal state."""
        return self.state in ("resolved", "cancelled")

    # Map trigger names to destination states (for fallback without transitions lib)
    TRIGGER_TO_STATE = {
        "start_triage": "triaging",
        "start_dispatch": "dispatching",
        "ambulance_acknowledge": "ambulance_acked",
        "ambulance_depart": "en_route",
        "arrive_on_scene": "on_scene",
        "begin_transport": "transporting",
        "arrive_at_hospital": "at_hospital",
        "resolve": "resolved",
        "escalate": "escalated",
        "cancel": "cancelled",
    }

    def transition_to(self, trigger: str, metadata: dict | None = None) -> bool:
        """Attempt a state transition by trigger name.

        This is a generic method for use by the API when the trigger name
        comes from an external source (e.g. webhook or API call).

        Returns True if transition succeeded, False otherwise.
        """
        if not HAS_TRANSITIONS:
            # Minimal fallback: map trigger to destination state
            dest = self.TRIGGER_TO_STATE.get(trigger)
            if dest:
                self.state = dest
                self._record_timeline(dest, metadata)
                return True
            logger.warning("Unknown trigger '%s'", trigger)
            return False

        try:
            trigger_fn = getattr(self, trigger, None)
            if trigger_fn and callable(trigger_fn):
                trigger_fn(metadata=metadata or {})
                return True
            else:
                logger.warning(
                    "Invalid trigger '%s' for session %s in state %s",
                    trigger, self.session_id, self.state,
                )
                return False
        except Exception as e:
            logger.error(
                "Transition failed: trigger=%s session=%s state=%s error=%s",
                trigger, self.session_id, self.state, e,
            )
            return False

    def to_dict(self) -> dict:
        """Serialize session state for API responses."""
        return {
            "session_id": self.session_id,
            "state": self.state,
            "tracker_stage": self.tracker_stage,
            "tracker_label": self.tracker_label,
            "is_terminal": self.is_terminal,
            "timeline": self.timeline,
        }
