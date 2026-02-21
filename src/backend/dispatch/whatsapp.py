"""WhatsApp messaging layer — stubbed for prototype, swappable for Twilio WhatsApp API.

In production, this module calls the Twilio WhatsApp API (or Meta Cloud API directly).
For the prototype, it logs all messages and returns simulated delivery receipts.

To switch to real WhatsApp:
1. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER in .env
2. Pre-register message templates with Meta via Twilio console
3. The send_whatsapp_message() interface stays the same
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from dataclasses import dataclass, field

logger = logging.getLogger("golden_hour.whatsapp")

# ---------------------------------------------------------------------------
# Message models
# ---------------------------------------------------------------------------

@dataclass
class WhatsAppMessage:
    """A single WhatsApp message to be sent."""
    to: str                          # Phone number (E.164 format)
    body: str                        # Message text
    template_name: str | None = None # Pre-approved template name (for production)
    template_params: dict = field(default_factory=dict)
    location: dict | None = None     # Optional location share {lat, lng, label}
    interactive_buttons: list[str] | None = None  # e.g. ["ACCEPT", "DECLINE"]
    channel: str = ""                # Which dispatch channel (hospital, ambulance, nurse, family)
    priority: str = "high"           # high or normal


@dataclass
class WhatsAppDeliveryReceipt:
    """Result of sending a WhatsApp message."""
    message_id: str
    to: str
    status: str  # queued, sent, delivered, read, failed
    channel: str
    timestamp: str
    simulated: bool = True  # True when using stub


# ---------------------------------------------------------------------------
# Message log — stores all messages for the prototype UI to display
# ---------------------------------------------------------------------------

_message_log: list[dict] = []


def get_message_log() -> list[dict]:
    """Get all sent messages (for prototype UI display)."""
    return _message_log.copy()


def clear_message_log():
    """Clear the message log."""
    _message_log.clear()


# ---------------------------------------------------------------------------
# Stub implementation — logs messages, returns simulated receipts
# ---------------------------------------------------------------------------

async def send_whatsapp_message(msg: WhatsAppMessage) -> WhatsAppDeliveryReceipt:
    """Send a WhatsApp message.

    In prototype mode: logs the message and returns a simulated receipt.
    In production mode: calls Twilio WhatsApp API.
    """
    use_real = os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN")

    if use_real:
        return await _send_via_twilio(msg)
    else:
        return await _send_stub(msg)


async def _send_stub(msg: WhatsAppMessage) -> WhatsAppDeliveryReceipt:
    """Stub: log the message and return a simulated delivery."""
    message_id = f"wamsg_{uuid.uuid4().hex[:12]}"
    timestamp = datetime.now(timezone.utc).isoformat()

    log_entry = {
        "message_id": message_id,
        "to": msg.to,
        "body": msg.body,
        "channel": msg.channel,
        "priority": msg.priority,
        "timestamp": timestamp,
        "status": "delivered",
        "simulated": True,
    }

    if msg.location:
        log_entry["location"] = msg.location
    if msg.interactive_buttons:
        log_entry["interactive_buttons"] = msg.interactive_buttons

    _message_log.append(log_entry)

    logger.info(
        "[WHATSAPP-STUB] %s → %s: %s",
        msg.channel.upper(),
        msg.to,
        msg.body[:100] + ("..." if len(msg.body) > 100 else ""),
    )

    return WhatsAppDeliveryReceipt(
        message_id=message_id,
        to=msg.to,
        status="delivered",
        channel=msg.channel,
        timestamp=timestamp,
        simulated=True,
    )


async def _send_via_twilio(msg: WhatsAppMessage) -> WhatsAppDeliveryReceipt:
    """Production: send via Twilio WhatsApp API."""
    # Lazy import — only needed when actually using Twilio
    from twilio.rest import Client

    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_WHATSAPP_NUMBER", "whatsapp:+14155238886")  # Twilio sandbox default

    client = Client(account_sid, auth_token)

    try:
        twilio_msg = client.messages.create(
            body=msg.body,
            from_=f"whatsapp:{from_number}" if not from_number.startswith("whatsapp:") else from_number,
            to=f"whatsapp:{msg.to}" if not msg.to.startswith("whatsapp:") else msg.to,
        )

        timestamp = datetime.now(timezone.utc).isoformat()

        log_entry = {
            "message_id": twilio_msg.sid,
            "to": msg.to,
            "body": msg.body,
            "channel": msg.channel,
            "priority": msg.priority,
            "timestamp": timestamp,
            "status": twilio_msg.status,
            "simulated": False,
        }
        _message_log.append(log_entry)

        logger.info("[WHATSAPP-TWILIO] %s → %s: %s (sid=%s)", msg.channel.upper(), msg.to, msg.body[:80], twilio_msg.sid)

        return WhatsAppDeliveryReceipt(
            message_id=twilio_msg.sid,
            to=msg.to,
            status=twilio_msg.status,
            channel=msg.channel,
            timestamp=timestamp,
            simulated=False,
        )

    except Exception as e:
        logger.error("[WHATSAPP-TWILIO] Failed to send to %s: %s", msg.to, e)
        timestamp = datetime.now(timezone.utc).isoformat()
        return WhatsAppDeliveryReceipt(
            message_id=f"failed_{uuid.uuid4().hex[:8]}",
            to=msg.to,
            status="failed",
            channel=msg.channel,
            timestamp=timestamp,
            simulated=False,
        )
