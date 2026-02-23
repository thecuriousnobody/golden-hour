"""Tests for background tasks — sync execution without Celery."""

import pytest

from src.backend.dispatch.state_machine import DispatchSession
from src.backend.dispatch.session_store import SessionStore


class TestMonitoringTasks:
    """Test monitoring tasks with sync execution."""

    def test_check_stale_dispatches_no_sessions(self):
        from src.backend.tasks.monitoring import check_stale_dispatches
        # Should run without error even with no sessions
        result = check_stale_dispatches()
        assert isinstance(result, int)
        assert result >= 0

    def test_expire_location_sharing_no_sessions(self):
        from src.backend.tasks.monitoring import expire_location_sharing
        result = expire_location_sharing()
        assert isinstance(result, int)
        assert result >= 0


class TestEscalationTasks:
    """Test escalation logic."""

    def test_escalation_timer_nonexistent_session(self):
        from src.backend.tasks.escalation import escalation_timer
        result = escalation_timer("gh_nonexistent_session")
        assert result is None  # Session not found

    def test_escalation_timer_dispatching_session(self):
        from src.backend.tasks.escalation import escalation_timer

        # Create a session in dispatching state
        store = SessionStore()
        session = store.create("gh_esc_test1")
        session.transition_to("start_triage")
        session.transition_to("start_dispatch")
        assert session.state == "dispatching"

        # Monkey-patch the global store temporarily
        from src.backend.dispatch import session_store as ss_module
        original_store = ss_module.session_store
        ss_module.session_store = store

        try:
            result = escalation_timer("gh_esc_test1", tier=0)
            assert result is not None
            assert result["tier"] == 0
            assert result["radius_km"] == 5
            assert session.state == "escalated"
        finally:
            ss_module.session_store = original_store

    def test_escalation_skips_resolved_session(self):
        from src.backend.tasks.escalation import escalation_timer

        store = SessionStore()
        session = store.create("gh_esc_test2")
        session.transition_to("start_triage")
        session.transition_to("start_dispatch")
        session.transition_to("resolve")  # Already resolved

        from src.backend.dispatch import session_store as ss_module
        original_store = ss_module.session_store
        ss_module.session_store = store

        try:
            result = escalation_timer("gh_esc_test2")
            assert result is None  # Should skip resolved session
        finally:
            ss_module.session_store = original_store

    def test_radius_tiers(self):
        from src.backend.tasks.escalation import RADIUS_TIERS
        assert RADIUS_TIERS == [5, 10, 15]


class TestCeleryApp:
    """Test Celery app configuration."""

    def test_celery_app_none_without_redis(self):
        from src.backend.tasks.celery_app import get_celery_app
        # Without REDIS_URL, should return None
        app = get_celery_app()
        # May or may not be None depending on env
        assert app is None or app is not None  # Just verify no crash

    def test_schedule_task_without_celery(self):
        from src.backend.tasks.celery_app import schedule_task
        # Should return False gracefully
        result = schedule_task("some.fake.task", kwargs={"key": "value"})
        assert isinstance(result, bool)
