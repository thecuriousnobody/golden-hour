"""Firebase Cloud Messaging (FCM) push notification channel.

Stub/real dual mode — uses stub if FIREBASE_CREDENTIALS_PATH is not set.
"""

import os
import uuid
import logging

from src.backend.notifications.models import NotificationReceipt

logger = logging.getLogger("golden_hour.notifications.fcm")


async def send_push(
    fcm_token: str,
    title: str,
    body: str,
    data: dict | None = None,
    priority: str = "high",
) -> NotificationReceipt:
    """Send a push notification via FCM.

    Args:
        fcm_token: Device FCM registration token
        title: Notification title
        body: Notification body text
        data: Optional data payload
        priority: "high" or "normal"

    Returns:
        NotificationReceipt with delivery status.
    """
    creds_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "")
    if creds_path and os.path.exists(creds_path):
        return await _send_real(fcm_token, title, body, data, priority)
    else:
        return await _send_stub(fcm_token, title, body, data, priority)


async def _send_stub(
    fcm_token: str,
    title: str,
    body: str,
    data: dict | None,
    priority: str,
) -> NotificationReceipt:
    """Stub: log and return simulated receipt."""
    message_id = f"fcm_stub_{uuid.uuid4().hex[:8]}"
    logger.info("[FCM-STUB] Push to %s: %s — %s", fcm_token[:20], title, body[:80])
    return NotificationReceipt(
        channel="fcm",
        recipient=fcm_token,
        status="stubbed",
        message_id=message_id,
        simulated=True,
    )


async def _send_real(
    fcm_token: str,
    title: str,
    body: str,
    data: dict | None,
    priority: str,
) -> NotificationReceipt:
    """Real FCM push via firebase-admin SDK."""
    try:
        import firebase_admin
        from firebase_admin import messaging

        # Initialize Firebase if not already done
        if not firebase_admin._apps:
            creds_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
            cred = firebase_admin.credentials.Certificate(creds_path)
            firebase_admin.initialize_app(cred)

        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=data or {},
            token=fcm_token,
            android=messaging.AndroidConfig(priority=priority),
        )

        response = messaging.send(message)

        return NotificationReceipt(
            channel="fcm",
            recipient=fcm_token,
            status="sent",
            message_id=response,
            simulated=False,
        )

    except Exception as e:
        logger.error("[FCM] Failed to send push: %s", e)
        return NotificationReceipt(
            channel="fcm",
            recipient=fcm_token,
            status="failed",
            error=str(e),
            simulated=False,
        )
