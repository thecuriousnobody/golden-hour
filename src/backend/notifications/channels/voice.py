"""Twilio Voice call notification channel.

Used ONLY for ESI-1 and ESI-2 (life-threatening) emergencies where
push/SMS might be missed. Makes an automated voice call to the responder.

Stub/real dual mode — uses stub if TWILIO_ACCOUNT_SID is not set.
"""

import os
import uuid
import logging

from src.backend.notifications.models import NotificationReceipt

logger = logging.getLogger("golden_hour.notifications.voice")


async def send_voice_call(
    phone: str,
    message: str,
    esi_level: int = 2,
) -> NotificationReceipt:
    """Make an automated voice call for critical emergencies.

    Only triggers for ESI-1 and ESI-2 by design. For ESI-3+ the caller
    receives push/SMS instead.

    Args:
        phone: Recipient phone number (E.164)
        message: Text-to-speech message content
        esi_level: ESI level (voice calls only for 1-2)

    Returns:
        NotificationReceipt with call status.
    """
    if esi_level > 2:
        logger.info("[VOICE] Skipping voice call for ESI-%d (only ESI-1/2)", esi_level)
        return NotificationReceipt(
            channel="voice",
            recipient=phone,
            status="skipped",
            message_id="",
            simulated=True,
        )

    use_real = os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN")
    if use_real:
        return await _call_real(phone, message)
    else:
        return await _call_stub(phone, message)


async def _call_stub(phone: str, message: str) -> NotificationReceipt:
    """Stub: log and return simulated call receipt."""
    call_id = f"voice_stub_{uuid.uuid4().hex[:8]}"
    logger.info("[VOICE-STUB] Calling %s: %s", phone, message[:80])
    return NotificationReceipt(
        channel="voice",
        recipient=phone,
        status="stubbed",
        message_id=call_id,
        simulated=True,
    )


async def _call_real(phone: str, message: str) -> NotificationReceipt:
    """Real voice call via Twilio."""
    try:
        from twilio.rest import Client

        client = Client(
            os.getenv("TWILIO_ACCOUNT_SID"),
            os.getenv("TWILIO_AUTH_TOKEN"),
        )

        # Use TwiML to speak the message
        twiml = (
            f'<Response><Say voice="alice" language="en-IN">{message}</Say>'
            f'<Pause length="1"/>'
            f'<Say voice="alice" language="en-IN">Press 1 to accept. Press 2 to decline.</Say>'
            f'<Gather numDigits="1" action="/api/v1/notifications/voice-response"/>'
            f'</Response>'
        )

        call = client.calls.create(
            twiml=twiml,
            to=phone,
            from_=os.getenv("TWILIO_PHONE_NUMBER"),
        )

        return NotificationReceipt(
            channel="voice",
            recipient=phone,
            status=call.status or "initiated",
            message_id=call.sid,
            simulated=False,
        )

    except Exception as e:
        logger.error("[VOICE] Failed to call %s: %s", phone, e)
        return NotificationReceipt(
            channel="voice",
            recipient=phone,
            status="failed",
            error=str(e),
            simulated=False,
        )
