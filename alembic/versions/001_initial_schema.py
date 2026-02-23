"""Initial schema — hospitals, responders, certifications, sessions, dispatch logs, response records.

Revision ID: 001_initial
Revises: None
Create Date: 2026-02-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable PostGIS (safe to call if already enabled)
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    # --- hospitals ---
    op.create_table(
        "hospitals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("city", sa.String(100), nullable=False, server_default="Bangalore"),
        sa.Column("address", sa.Text, server_default=""),
        sa.Column("capabilities", ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("lng", sa.Float, nullable=False),
        sa.Column("emergency_contact", sa.String(20), server_default=""),
        sa.Column("whatsapp_number", sa.String(20), server_default=""),
        sa.Column("verified", sa.Boolean, server_default="false"),
        sa.Column("abdm_id", sa.String(50), nullable=True),
        sa.Column("bed_count", sa.Integer, nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("location", sa.Column("location", sa.Text, nullable=True)),  # PostGIS added below
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_hospitals_name", "hospitals", ["name"])

    # Add PostGIS geometry column (if extension available)
    op.execute("ALTER TABLE hospitals DROP COLUMN IF EXISTS location")
    op.execute("SELECT AddGeometryColumn('hospitals', 'location', 4326, 'POINT', 2)")
    op.execute("CREATE INDEX ix_hospitals_location ON hospitals USING GIST (location)")

    # --- responders ---
    op.execute("CREATE TYPE responder_role AS ENUM ('nurse', 'emt', 'paramedic', 'first_responder')")
    op.create_table(
        "responders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.Enum("nurse", "emt", "paramedic", "first_responder", name="responder_role", create_type=False), nullable=False, server_default="nurse"),
        sa.Column("qualification", sa.String(100), server_default=""),
        sa.Column("specialization", sa.String(100), server_default=""),
        sa.Column("languages", ARRAY(sa.String), server_default="{}"),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("whatsapp_number", sa.String(20), server_default=""),
        sa.Column("lat", sa.Float, nullable=True),
        sa.Column("lng", sa.Float, nullable=True),
        sa.Column("radius_km", sa.Float, server_default="5.0"),
        sa.Column("available", sa.Boolean, server_default="true"),
        sa.Column("fcm_token", sa.Text, nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.execute("SELECT AddGeometryColumn('responders', 'location', 4326, 'POINT', 2)")
    op.execute("CREATE INDEX ix_responders_location ON responders USING GIST (location)")

    # --- certifications ---
    op.create_table(
        "certifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("responder_id", UUID(as_uuid=True), sa.ForeignKey("responders.id"), nullable=False),
        sa.Column("cert_type", sa.String(100), nullable=False),
        sa.Column("cert_number", sa.String(100), nullable=True),
        sa.Column("issuer", sa.String(255), server_default=""),
        sa.Column("issued_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expiry_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # --- emergency_sessions ---
    op.create_table(
        "emergency_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("session_code", sa.String(20), unique=True, nullable=False),
        sa.Column("state", sa.String(30), nullable=False, server_default="initiated"),
        sa.Column("caller_name", sa.String(255), server_default="Unknown Caller"),
        sa.Column("caller_phone", sa.String(20), server_default=""),
        sa.Column("caller_lat", sa.Float, nullable=True),
        sa.Column("caller_lng", sa.Float, nullable=True),
        sa.Column("language", sa.String(10), server_default="en"),
        sa.Column("transcript_english", sa.Text, server_default=""),
        sa.Column("transcript_original", sa.Text, nullable=True),
        sa.Column("triage_result", JSONB, nullable=True),
        sa.Column("likely_condition", sa.String(255), server_default=""),
        sa.Column("severity", sa.String(20), server_default=""),
        sa.Column("esi_level", sa.Integer, nullable=True),
        sa.Column("triage_score", sa.Integer, nullable=True),
        sa.Column("required_capabilities", ARRAY(sa.String), server_default="{}"),
        sa.Column("hospital_id", UUID(as_uuid=True), sa.ForeignKey("hospitals.id"), nullable=True),
        sa.Column("ambulance_id", sa.String(50), nullable=True),
        sa.Column("timeline", JSONB, server_default="[]"),
        sa.Column("family_contacts", JSONB, server_default="[]"),
        sa.Column("location_sharing_active", sa.Boolean, server_default="true"),
        sa.Column("location_expiry", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tracking_url", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_emergency_sessions_session_code", "emergency_sessions", ["session_code"])
    op.execute("SELECT AddGeometryColumn('emergency_sessions', 'caller_location', 4326, 'POINT', 2)")

    # --- dispatch_logs ---
    op.create_table(
        "dispatch_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("session_id", UUID(as_uuid=True), sa.ForeignKey("emergency_sessions.id"), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("hospital_id", UUID(as_uuid=True), sa.ForeignKey("hospitals.id"), nullable=True),
        sa.Column("target_phone", sa.String(20), server_default=""),
        sa.Column("message_body", sa.Text, server_default=""),
        sa.Column("message_id", sa.String(100), nullable=True),
        sa.Column("delivery_status", sa.String(20), server_default="pending"),
        sa.Column("details", JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # --- response_records ---
    op.execute("CREATE TYPE response_action AS ENUM ('alerted', 'accepted', 'declined', 'arrived', 'completed')")
    op.create_table(
        "response_records",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("session_id", UUID(as_uuid=True), sa.ForeignKey("emergency_sessions.id"), nullable=False),
        sa.Column("responder_id", UUID(as_uuid=True), sa.ForeignKey("responders.id"), nullable=False),
        sa.Column("action", sa.Enum("alerted", "accepted", "declined", "arrived", "completed", name="response_action", create_type=False), nullable=False),
        sa.Column("channel", sa.String(20), server_default=""),
        sa.Column("lat", sa.Float, nullable=True),
        sa.Column("lng", sa.Float, nullable=True),
        sa.Column("notes", sa.Text, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("response_records")
    op.drop_table("dispatch_logs")
    op.drop_table("emergency_sessions")
    op.drop_table("certifications")
    op.drop_table("responders")
    op.drop_table("hospitals")
    op.execute("DROP TYPE IF EXISTS response_action")
    op.execute("DROP TYPE IF EXISTS responder_role")
