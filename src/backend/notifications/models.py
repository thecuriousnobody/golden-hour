"""Notification data models."""

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class NotificationReceipt:
    """Result of sending a notification through any channel."""
    channel: str          # fcm, sms, voice, whatsapp
    recipient: str        # Phone number or FCM token
    status: str           # sent, delivered, failed, stubbed
    message_id: str = ""
    timestamp: str = ""
    error: str = ""
    simulated: bool = True

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()
