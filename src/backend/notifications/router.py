"""Multi-channel notification endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.backend.notifications.service import notification_service

router = APIRouter()


class NotificationRequest(BaseModel):
    channel: str = Field(description="Channel: sms, push, voice, cascade")
    recipient: str = Field(description="Phone number or FCM token")
    message: str
    title: str = "Emergency Alert"
    priority: str = "high"
    esi_level: int = Field(default=3, ge=1, le=5)
    fcm_token: str | None = None


class NotificationResult(BaseModel):
    channel: str
    status: str
    message_id: str | None = None
    receipts: list[dict] = []


@router.post("/send", response_model=NotificationResult)
async def send_notification(request: NotificationRequest):
    """Send notification via specified channel or cascade.

    Channels:
    - sms: Send SMS via Twilio
    - push: Send FCM push notification
    - voice: Make automated voice call (ESI-1/2 only)
    - cascade: Send via all channels (FCM + SMS + Voice for critical)
    """
    if request.channel == "cascade":
        result = await notification_service.alert_responder(
            phone=request.recipient,
            message=request.message,
            title=request.title,
            esi_level=request.esi_level,
            fcm_token=request.fcm_token,
        )
        return NotificationResult(
            channel="cascade",
            status="sent" if result.success else "failed",
            receipts=[
                {"channel": r.channel, "status": r.status, "message_id": r.message_id}
                for r in result.receipts
            ],
        )

    elif request.channel == "sms":
        from src.backend.notifications.channels.sms import send_sms
        receipt = await send_sms(request.recipient, request.message)
        return NotificationResult(
            channel="sms",
            status=receipt.status,
            message_id=receipt.message_id,
        )

    elif request.channel == "push":
        from src.backend.notifications.channels.fcm import send_push
        receipt = await send_push(
            request.fcm_token or request.recipient,
            request.title,
            request.message,
        )
        return NotificationResult(
            channel="push",
            status=receipt.status,
            message_id=receipt.message_id,
        )

    elif request.channel == "voice":
        from src.backend.notifications.channels.voice import send_voice_call
        receipt = await send_voice_call(
            request.recipient,
            request.message,
            request.esi_level,
        )
        return NotificationResult(
            channel="voice",
            status=receipt.status,
            message_id=receipt.message_id,
        )

    return NotificationResult(
        channel=request.channel,
        status="error",
        message_id=None,
    )
