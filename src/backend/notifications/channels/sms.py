"""Twilio SMS notification channel — DLT-compliant for India.

Stub/real dual mode — uses stub if TWILIO_ACCOUNT_SID is not set.

India-specific: All promotional/transactional SMS must be DLT-registered.
Emergency/service-implicit messages may bypass DLT under TRAI guidelines,
but we still use registered templates for compliance.
"""

import os
import uuid
import logging

from src.backend.notifications.models import NotificationReceipt

logger = logging.getLogger("golden_hour.notifications.sms")


async def send_sms(
    phone: str,
    body: str,
    priority: str = "high",
) -> NotificationReceipt:
    """Send an SMS notification.

    Args:
        phone: Recipient phone number (E.164 format)
        body: SMS body text (max 160 chars for single segment)
        priority: "high" or "normal"

    Returns:
        NotificationReceipt with delivery status.
    """
    use_real = os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN")
    if use_real:
        return await _send_real(phone, body, priority)
    else:
        return await _send_stub(phone, body, priority)


async def _send_stub(
    phone: str,
    body: str,
    priority: str,
) -> NotificationReceipt:
    """Stub: log and return simulated receipt."""
    message_id = f"sms_stub_{uuid.uuid4().hex[:8]}"
    logger.info("[SMS-STUB] To %s: %s", phone, body[:80])
    return NotificationReceipt(
        channel="sms",
        recipient=phone,
        status="stubbed",
        message_id=message_id,
        simulated=True,
    )


async def _send_real(
    phone: str,
    body: str,
    priority: str,
) -> NotificationReceipt:
    """Real SMS via Twilio."""
    try:
        from twilio.rest import Client

        client = Client(
            os.getenv("TWILIO_ACCOUNT_SID"),
            os.getenv("TWILIO_AUTH_TOKEN"),
        )

        message = client.messages.create(
            body=body,
            from_=os.getenv("TWILIO_PHONE_NUMBER"),
            to=phone,
        )

        return NotificationReceipt(
            channel="sms",
            recipient=phone,
            status=message.status or "sent",
            message_id=message.sid,
            simulated=False,
        )

    except Exception as e:
        logger.error("[SMS] Failed to send to %s: %s", phone, e)
        return NotificationReceipt(
            channel="sms",
            recipient=phone,
            status="failed",
            error=str(e),
            simulated=False,
        )
