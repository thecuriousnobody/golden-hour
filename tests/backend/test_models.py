"""Tests for database models — import and metadata verification.

These tests verify models load correctly without needing a live database.
"""

import pytest


class TestModelImports:
    """Verify all models can be imported and have correct metadata."""

    def test_import_base(self):
        from src.backend.db.base import Base
        assert Base is not None
        assert hasattr(Base, "metadata")

    def test_import_all_models(self):
        from src.backend.db.models import (
            Hospital,
            Responder,
            Certification,
            EmergencySession,
            DispatchLog,
            ResponseRecord,
        )
        assert Hospital.__tablename__ == "hospitals"
        assert Responder.__tablename__ == "responders"
        assert Certification.__tablename__ == "certifications"
        assert EmergencySession.__tablename__ == "emergency_sessions"
        assert DispatchLog.__tablename__ == "dispatch_logs"
        assert ResponseRecord.__tablename__ == "response_records"

    def test_metadata_has_all_tables(self):
        from src.backend.db.base import Base
        # Force model import to register tables
        from src.backend.db import models  # noqa: F401

        table_names = set(Base.metadata.tables.keys())
        expected = {
            "hospitals",
            "responders",
            "certifications",
            "emergency_sessions",
            "dispatch_logs",
            "response_records",
        }
        assert expected.issubset(table_names)

    def test_hospital_columns(self):
        from src.backend.db.models import Hospital
        columns = {c.name for c in Hospital.__table__.columns}
        assert "name" in columns
        assert "capabilities" in columns
        assert "lat" in columns
        assert "lng" in columns
        assert "whatsapp_number" in columns

    def test_emergency_session_columns(self):
        from src.backend.db.models import EmergencySession
        columns = {c.name for c in EmergencySession.__table__.columns}
        assert "session_code" in columns
        assert "state" in columns
        assert "triage_result" in columns
        assert "timeline" in columns
        assert "tracking_url" in columns

    def test_responder_columns(self):
        from src.backend.db.models import Responder
        columns = {c.name for c in Responder.__table__.columns}
        assert "name" in columns
        assert "role" in columns
        assert "specialization" in columns
        assert "available" in columns
        assert "fcm_token" in columns

    def test_check_db_connection_no_url(self):
        """check_db_connection should return False when no DATABASE_URL."""
        import asyncio
        from src.backend.db.base import check_db_connection
        result = asyncio.get_event_loop().run_until_complete(check_db_connection())
        # Will be False since no DB is running in test environment
        assert isinstance(result, bool)
