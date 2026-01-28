"""Multi-channel notification endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class NotificationRequest(BaseModel):
    channel: str  # sms, push, voice
    recipient: str
    message: str
    priority: str = "high"


class NotificationResult(BaseModel):
    channel: str
    status: str
    message_id: str | None = None


@router.post("/send", response_model=NotificationResult)
async def send_notification(request: NotificationRequest):
    """Send notification via specified channel."""
    # TODO: Integrate Twilio (SMS/Voice) and Firebase (Push)
    return NotificationResult(
        channel=request.channel,
        status="pending",
    )
