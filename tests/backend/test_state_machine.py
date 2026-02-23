"""Tests for the dispatch state machine."""

import pytest

from src.backend.dispatch.state_machine import (
    DispatchSession,
    STATES,
    TRACKER_STAGES,
    TRACKER_LABELS,
)
from src.backend.dispatch.session_store import SessionStore


class TestDispatchSession:
    """Test state machine transitions."""

    def test_initial_state(self):
        """Session starts in 'initiated' state."""
        session = DispatchSession("gh_test001")
        assert session.state == "initiated"
        assert session.tracker_stage == 1
        assert session.tracker_label == "Emergency Reported"

    def test_happy_path(self):
        """Full lifecycle: initiated -> ... -> resolved."""
        session = DispatchSession("gh_test002")

        session.transition_to("start_triage")
        assert session.state == "triaging"
        assert session.tracker_stage == 2

        session.transition_to("start_dispatch")
        assert session.state == "dispatching"
        assert session.tracker_stage == 3

        session.transition_to("ambulance_acknowledge", {"ambulance_id": "amb_001"})
        assert session.state == "ambulance_acked"
        assert session.tracker_stage == 4

        session.transition_to("ambulance_depart")
        assert session.state == "en_route"
        assert session.tracker_stage == 5

        session.transition_to("arrive_on_scene")
        assert session.state == "on_scene"
        assert session.tracker_stage == 6

        session.transition_to("begin_transport")
        assert session.state == "transporting"
        assert session.tracker_stage == 7

        session.transition_to("arrive_at_hospital")
        assert session.state == "at_hospital"
        assert session.tracker_stage == 8

        session.transition_to("resolve")
        assert session.state == "resolved"
        assert session.tracker_stage == 9
        assert session.is_terminal

    def test_timeline_recording(self):
        """Every transition should add a timeline entry."""
        session = DispatchSession("gh_test003")
        # Initial state is recorded
        assert len(session.timeline) == 1
        assert session.timeline[0]["state"] == "initiated"

        session.transition_to("start_triage")
        assert len(session.timeline) == 2
        assert session.timeline[1]["state"] == "triaging"
        assert "timestamp" in session.timeline[1]

    def test_escalation(self):
        """Session can be escalated from dispatching state."""
        session = DispatchSession("gh_test004")
        session.transition_to("start_triage")
        session.transition_to("start_dispatch")
        session.transition_to("escalate")
        assert session.state == "escalated"
        assert session.tracker_stage == 3  # Back to dispatch level

    def test_re_dispatch_after_escalation(self):
        """After escalation, can re-dispatch."""
        session = DispatchSession("gh_test005")
        session.transition_to("start_triage")
        session.transition_to("start_dispatch")
        session.transition_to("escalate")
        session.transition_to("start_dispatch")  # Re-dispatch
        assert session.state == "dispatching"

    def test_cancellation(self):
        """Session can be cancelled from multiple states."""
        for state_path in [
            [],  # initiated
            ["start_triage"],  # triaging
            ["start_triage", "start_dispatch"],  # dispatching
        ]:
            session = DispatchSession(f"gh_cancel_{len(state_path)}")
            for trigger in state_path:
                session.transition_to(trigger)
            session.transition_to("cancel")
            assert session.state == "cancelled"
            assert session.is_terminal

    def test_is_terminal(self):
        """Only resolved and cancelled are terminal."""
        session = DispatchSession("gh_test006")
        assert not session.is_terminal

        session.transition_to("start_triage")
        assert not session.is_terminal

    def test_to_dict(self):
        """Serialization should include all key fields."""
        session = DispatchSession("gh_test007")
        d = session.to_dict()
        assert d["session_id"] == "gh_test007"
        assert d["state"] == "initiated"
        assert d["tracker_stage"] == 1
        assert d["tracker_label"] == "Emergency Reported"
        assert isinstance(d["timeline"], list)
        assert not d["is_terminal"]

    def test_metadata_in_timeline(self):
        """Metadata passed to transitions should appear in timeline."""
        session = DispatchSession("gh_test008")
        session.transition_to("start_triage")
        session.transition_to("start_dispatch")
        session.transition_to(
            "ambulance_acknowledge",
            metadata={"ambulance_id": "amb_99", "driver": "Raju"},
        )
        ack_entry = session.timeline[-1]
        assert ack_entry["state"] == "ambulance_acked"
        assert ack_entry["metadata"].get("ambulance_id") == "amb_99"


class TestSessionStore:
    """Test the in-memory session store."""

    def test_create_and_get(self):
        store = SessionStore()
        session = store.create("gh_store001")
        assert session.session_id == "gh_store001"
        assert store.get("gh_store001") is session

    def test_get_nonexistent(self):
        store = SessionStore()
        assert store.get("gh_nonexistent") is None

    def test_list_active(self):
        store = SessionStore()
        s1 = store.create("gh_active1")
        s2 = store.create("gh_active2")
        s2.transition_to("start_triage")
        s2.transition_to("start_dispatch")

        # Cancel s2 to make it terminal
        s_cancel = store.create("gh_done")
        s_cancel.transition_to("cancel")

        active = store.list_active()
        active_ids = [s.session_id for s in active]
        assert "gh_active1" in active_ids
        assert "gh_active2" in active_ids
        assert "gh_done" not in active_ids

    def test_remove(self):
        store = SessionStore()
        store.create("gh_remove1")
        assert store.remove("gh_remove1")
        assert store.get("gh_remove1") is None
        assert not store.remove("gh_remove1")  # Already removed

    def test_count(self):
        store = SessionStore()
        assert store.count() == 0
        store.create("gh_c1")
        store.create("gh_c2")
        assert store.count() == 2
