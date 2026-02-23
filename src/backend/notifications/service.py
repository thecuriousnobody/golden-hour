"""Multi-channel Notification Service — cascade logic for emergency alerts.

Notification cascade for responders:
1. FCM push (instant, silent for non-critical)
2. SMS (fallback if no FCM token or push fails)
3. WhatsApp (primary dispatch channel)
4. Voice call (ESI-1/2 only — life-threatening emergencies)

Family notifications go through WhatsApp + SMS.
Escalation re-triggers the cascade for the next batch of responders.
"""

import asyncio
import logging
from dataclasses import dataclass, field

from src.backend.notifications.models import NotificationReceipt
from src.backend.notifications.channels.fcm import send_push
from src.backend.notifications.channels.sms import send_sms
from src.backend.notifications.channels.voice import send_voice_call

logger = logging.getLogger("golden_hour.notifications")


@dataclass
class CascadeResult:
    """Result of a multi-channel notification cascade."""
    recipient: str
    receipts: list[NotificationReceipt] = field(default_factory=list)
    success: bool = False

    @property
    def successful_channels(self) -> list[str]:
        return [r.channel for r in self.receipts if r.status in ("sent", "delivered", "stubbed")]


class NotificationService:
    """Orchestrates multi-channel notification delivery."""

    async def alert_responder(
        self,
        phone: str,
        message: str,
        title: str = "Emergency Alert",
        esi_level: int = 3,
        fcm_token: str | None = None,
    ) -> CascadeResult:
        """Send emergency alert to a responder via cascade.

        Cascade order: FCM -> SMS -> Voice (ESI-1/2 only)
        All channels fire in parallel for speed.
        """
        result = CascadeResult(recipient=phone)
        tasks = []

        # FCM push (if token available)
        if fcm_token:
            tasks.append(send_push(fcm_token, title, message))

        # SMS
        tasks.append(send_sms(phone, message))

        # Voice call for critical emergencies
        if esi_level <= 2:
            tasks.append(send_voice_call(phone, message, esi_level))

        receipts = await asyncio.gather(*tasks, return_exceptions=True)

        for r in receipts:
            if isinstance(r, NotificationReceipt):
                result.receipts.append(r)
            else:
                logger.error("Notification channel failed: %s", r)

        result.success = any(
            r.status in ("sent", "delivered", "stubbed")
            for r in result.receipts
        )

        return result

    async def notify_family(
        self,
        contacts: list[dict],
        message: str,
        session_id: str = "",
        tracking_url: str = "",
    ) -> list[CascadeResult]:
        """Send notifications to family/emergency contacts.

        Uses SMS + WhatsApp (WhatsApp handled separately by dispatch).
        Includes tracking URL if available.
        """
        results = []

        if tracking_url:
            message += f"\n\nTrack status: {tracking_url}"

        tasks = []
        for contact in contacts:
            phone = contact.get("phone", "")
            if phone:
                tasks.append(self._notify_single_family(phone, message))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            results = [r for r in results if isinstance(r, CascadeResult)]

        return results

    async def _notify_single_family(self, phone: str, message: str) -> CascadeResult:
        """Notify a single family member via SMS."""
        result = CascadeResult(recipient=phone)

        receipt = await send_sms(phone, message)
        result.receipts.append(receipt)
        result.success = receipt.status in ("sent", "delivered", "stubbed")

        return result

    async def send_escalation_alert(
        self,
        responder_phones: list[str],
        message: str,
        esi_level: int = 2,
    ) -> list[CascadeResult]:
        """Alert next batch of responders during escalation.

        Called when initial responders don't acknowledge within timeout.
        """
        tasks = [
            self.alert_responder(phone, message, "ESCALATION — Emergency Alert", esi_level)
            for phone in responder_phones
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [r for r in results if isinstance(r, CascadeResult)]


# Global singleton
notification_service = NotificationService()
