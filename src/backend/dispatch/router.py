"""Emergency dispatch orchestration endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class DispatchRequest(BaseModel):
    session_id: str
    triage_result: dict
    location: dict


class DispatchResult(BaseModel):
    dispatches: list[dict]
    status: str


@router.post("/initiate", response_model=DispatchResult)
async def initiate_dispatch(request: DispatchRequest):
    """Dispatch emergency response across all channels in parallel."""
    # TODO: Implement parallel dispatch to 108, hospital, volunteers, family
    return DispatchResult(dispatches=[], status="pending")
