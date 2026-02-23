"""Tests for multi-channel notification service in stub mode."""

import asyncio
import pytest
from fastapi.testclient import TestClient

from src.backend.main import app
from src.backend.notifications.models import NotificationReceipt

client = TestClient(app)


class TestNotificationChannels:
    """Test individual notification channels in stub mode."""

    def test_fcm_push_stub(self):
        from src.backend.notifications.channels.fcm import send_push
        receipt = asyncio.get_event_loop().run_until_complete(
            send_push("fake_fcm_token_123", "Test", "Emergency alert test")
        )
        assert receipt.channel == "fcm"
        assert receipt.status == "stubbed"
        assert receipt.simulated
        assert receipt.message_id.startswith("fcm_stub_")

    def test_sms_stub(self):
        from src.backend.notifications.channels.sms import send_sms
        receipt = asyncio.get_event_loop().run_until_complete(
            send_sms("+91-98450-12345", "Emergency: cardiac arrest nearby")
        )
        assert receipt.channel == "sms"
        assert receipt.status == "stubbed"
        assert receipt.simulated

    def test_voice_call_stub_critical(self):
        from src.backend.notifications.channels.voice import send_voice_call
        receipt = asyncio.get_event_loop().run_until_complete(
            send_voice_call("+91-98450-12345", "Critical emergency nearby", esi_level=1)
        )
        assert receipt.channel == "voice"
        assert receipt.status == "stubbed"
        assert receipt.simulated

    def test_voice_call_skips_non_critical(self):
        from src.backend.notifications.channels.voice import send_voice_call
        receipt = asyncio.get_event_loop().run_until_complete(
            send_voice_call("+91-98450-12345", "Moderate emergency", esi_level=3)
        )
        assert receipt.status == "skipped"

    def test_voice_call_esi_boundary(self):
        """ESI-2 should trigger voice call, ESI-3 should not."""
        from src.backend.notifications.channels.voice import send_voice_call

        esi2 = asyncio.get_event_loop().run_until_complete(
            send_voice_call("+91-98450-12345", "ESI-2 emergency", esi_level=2)
        )
        assert esi2.status == "stubbed"  # Should fire

        esi3 = asyncio.get_event_loop().run_until_complete(
            send_voice_call("+91-98450-12345", "ESI-3 emergency", esi_level=3)
        )
        assert esi3.status == "skipped"  # Should skip


class TestNotificationService:
    """Test the cascade notification service."""

    def test_alert_responder_cascade(self):
        from src.backend.notifications.service import notification_service
        result = asyncio.get_event_loop().run_until_complete(
            notification_service.alert_responder(
                phone="+91-98450-12345",
                message="Emergency nearby",
                esi_level=1,
                fcm_token="fake_token",
            )
        )
        assert result.success
        assert len(result.receipts) >= 2  # FCM + SMS + Voice for ESI-1
        channels = result.successful_channels
        assert "sms" in channels
        assert "fcm" in channels

    def test_alert_responder_no_fcm(self):
        from src.backend.notifications.service import notification_service
        result = asyncio.get_event_loop().run_until_complete(
            notification_service.alert_responder(
                phone="+91-98450-12345",
                message="Emergency",
                esi_level=3,
            )
        )
        assert result.success
        # Without FCM token and ESI-3, only SMS
        assert len(result.receipts) == 1
        assert result.receipts[0].channel == "sms"

    def test_notify_family(self):
        from src.backend.notifications.service import notification_service
        contacts = [
            {"name": "Son", "phone": "+91-98765-11111"},
            {"name": "Daughter", "phone": "+91-98765-22222"},
        ]
        results = asyncio.get_event_loop().run_until_complete(
            notification_service.notify_family(
                contacts=contacts,
                message="Emergency alert for your family member",
                tracking_url="https://goldenhour.app/track/gh_abc123",
            )
        )
        assert len(results) == 2
        for r in results:
            assert r.success

    def test_escalation_alert(self):
        from src.backend.notifications.service import notification_service
        phones = ["+91-98765-11111", "+91-98765-22222", "+91-98765-33333"]
        results = asyncio.get_event_loop().run_until_complete(
            notification_service.send_escalation_alert(
                responder_phones=phones,
                message="Escalation: No response from initial responders",
                esi_level=1,
            )
        )
        assert len(results) == 3


class TestNotificationEndpoint:
    """Test the /notifications/send API endpoint."""

    def test_send_sms(self):
        response = client.post(
            "/api/v1/notifications/send",
            json={
                "channel": "sms",
                "recipient": "+91-98450-12345",
                "message": "Emergency alert test",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["channel"] == "sms"
        assert data["status"] == "stubbed"

    def test_send_push(self):
        response = client.post(
            "/api/v1/notifications/send",
            json={
                "channel": "push",
                "recipient": "fake_fcm_token",
                "message": "Emergency push test",
                "fcm_token": "fake_fcm_token",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["channel"] == "push"
        assert data["status"] == "stubbed"

    def test_send_cascade(self):
        response = client.post(
            "/api/v1/notifications/send",
            json={
                "channel": "cascade",
                "recipient": "+91-98450-12345",
                "message": "Cascade emergency alert",
                "esi_level": 1,
                "fcm_token": "fake_token",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["channel"] == "cascade"
        assert data["status"] == "sent"
        assert len(data["receipts"]) >= 2
