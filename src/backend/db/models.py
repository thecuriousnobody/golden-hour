"""SQLAlchemy models for Golden Hour emergency dispatch.

Six models covering the full dispatch lifecycle:
- Hospital: facility with capabilities and PostGIS location
- Responder: nurse/EMT with certifications and availability
- Certification: professional credentials with verification
- EmergencySession: full session from triage to resolution
- DispatchLog: per-channel dispatch attempt with receipts
- ResponseRecord: responder accept/decline/arrival audit trail

PostGIS geometry columns are optional — if geoalchemy2 is not available or
PostGIS extension is missing, the models still work with plain lat/lng columns.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import relationship

from src.backend.db.base import Base

# Try to import GeoAlchemy2 — optional dependency
try:
    from geoalchemy2 import Geometry

    HAS_POSTGIS = True
except ImportError:
    HAS_POSTGIS = False
    Geometry = None


def _utcnow():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Hospital
# ---------------------------------------------------------------------------


class Hospital(Base):
    __tablename__ = "hospitals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    city = Column(String(100), nullable=False, default="Bangalore")
    address = Column(Text, default="")
    capabilities = Column(ARRAY(String), nullable=False, default=[])
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    emergency_contact = Column(String(20), default="")
    whatsapp_number = Column(String(20), default="")
    verified = Column(Boolean, default=False)
    abdm_id = Column(String(50), nullable=True)
    bed_count = Column(Integer, nullable=True)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    # PostGIS geometry (optional)
    if HAS_POSTGIS:
        location = Column(Geometry("POINT", srid=4326), nullable=True)

    dispatch_logs = relationship("DispatchLog", back_populates="hospital")


# ---------------------------------------------------------------------------
# Responder (nurse / EMT / first responder)
# ---------------------------------------------------------------------------


class Responder(Base):
    __tablename__ = "responders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    role = Column(
        SAEnum("nurse", "emt", "paramedic", "first_responder", name="responder_role"),
        nullable=False,
        default="nurse",
    )
    qualification = Column(String(100), default="")
    specialization = Column(String(100), default="")
    languages = Column(ARRAY(String), default=[])
    phone = Column(String(20), nullable=False)
    whatsapp_number = Column(String(20), default="")
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    radius_km = Column(Float, default=5.0)
    available = Column(Boolean, default=True)
    fcm_token = Column(Text, nullable=True)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    if HAS_POSTGIS:
        location = Column(Geometry("POINT", srid=4326), nullable=True)

    certifications = relationship("Certification", back_populates="responder")
    response_records = relationship("ResponseRecord", back_populates="responder")


# ---------------------------------------------------------------------------
# Certification
# ---------------------------------------------------------------------------


class Certification(Base):
    __tablename__ = "certifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    responder_id = Column(
        UUID(as_uuid=True), ForeignKey("responders.id"), nullable=False
    )
    cert_type = Column(String(100), nullable=False)  # e.g. "BLS", "ACLS", "RN"
    cert_number = Column(String(100), nullable=True)
    issuer = Column(String(255), default="")
    issued_date = Column(DateTime(timezone=True), nullable=True)
    expiry_date = Column(DateTime(timezone=True), nullable=True)
    verified = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    responder = relationship("Responder", back_populates="certifications")


# ---------------------------------------------------------------------------
# EmergencySession
# ---------------------------------------------------------------------------


class EmergencySession(Base):
    __tablename__ = "emergency_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_code = Column(String(20), unique=True, nullable=False, index=True)
    state = Column(String(30), nullable=False, default="initiated")

    # Caller
    caller_name = Column(String(255), default="Unknown Caller")
    caller_phone = Column(String(20), default="")
    caller_lat = Column(Float, nullable=True)
    caller_lng = Column(Float, nullable=True)
    language = Column(String(10), default="en")

    # Transcripts
    transcript_english = Column(Text, default="")
    transcript_original = Column(Text, nullable=True)

    # Triage
    triage_result = Column(JSONB, nullable=True)
    likely_condition = Column(String(255), default="")
    severity = Column(String(20), default="")
    esi_level = Column(Integer, nullable=True)
    triage_score = Column(Integer, nullable=True)
    required_capabilities = Column(ARRAY(String), default=[])

    # Dispatch
    hospital_id = Column(UUID(as_uuid=True), ForeignKey("hospitals.id"), nullable=True)
    ambulance_id = Column(String(50), nullable=True)

    # Timeline
    timeline = Column(JSONB, default=[])

    # Family contacts
    family_contacts = Column(JSONB, default=[])

    # Privacy
    location_sharing_active = Column(Boolean, default=True)
    location_expiry = Column(DateTime(timezone=True), nullable=True)

    # Tracking URL
    tracking_url = Column(String(500), nullable=True)

    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    if HAS_POSTGIS:
        caller_location = Column(Geometry("POINT", srid=4326), nullable=True)

    dispatch_logs = relationship("DispatchLog", back_populates="session")
    response_records = relationship("ResponseRecord", back_populates="session")


# ---------------------------------------------------------------------------
# DispatchLog
# ---------------------------------------------------------------------------


class DispatchLog(Base):
    __tablename__ = "dispatch_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(
        UUID(as_uuid=True), ForeignKey("emergency_sessions.id"), nullable=False
    )
    channel = Column(String(20), nullable=False)  # hospital, ambulance, nurse, family
    status = Column(String(20), nullable=False, default="pending")
    hospital_id = Column(UUID(as_uuid=True), ForeignKey("hospitals.id"), nullable=True)
    target_phone = Column(String(20), default="")
    message_body = Column(Text, default="")
    message_id = Column(String(100), nullable=True)
    delivery_status = Column(String(20), default="pending")
    details = Column(JSONB, default={})
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    session = relationship("EmergencySession", back_populates="dispatch_logs")
    hospital = relationship("Hospital", back_populates="dispatch_logs")


# ---------------------------------------------------------------------------
# ResponseRecord (responder accept/decline/arrival audit trail)
# ---------------------------------------------------------------------------


class ResponseRecord(Base):
    __tablename__ = "response_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(
        UUID(as_uuid=True), ForeignKey("emergency_sessions.id"), nullable=False
    )
    responder_id = Column(
        UUID(as_uuid=True), ForeignKey("responders.id"), nullable=False
    )
    action = Column(
        SAEnum(
            "alerted",
            "accepted",
            "declined",
            "arrived",
            "completed",
            name="response_action",
        ),
        nullable=False,
    )
    channel = Column(String(20), default="")  # whatsapp, sms, push, voice
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    notes = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    session = relationship("EmergencySession", back_populates="response_records")
    responder = relationship("Responder", back_populates="response_records")
