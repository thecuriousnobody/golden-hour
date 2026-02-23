"""Golden Hour - Backend API Server"""

import os
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from src.backend.speech.router import router as speech_router
from src.backend.triage.router import router as triage_router
from src.backend.dispatch.router import router as dispatch_router
from src.backend.notifications.router import router as notifications_router
from src.backend.pipeline import router as pipeline_router
from src.backend.realtime.router import router as realtime_router
from src.backend.dispatch.hospital_matcher import load_hospitals

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Golden Hour API starting up...")
    load_hospitals()

    # Non-blocking DB connection test
    try:
        from src.backend.db.base import check_db_connection
        await check_db_connection()
    except Exception as e:
        logging.getLogger("golden_hour").info("DB check skipped: %s", e)

    # Non-blocking Redis connection test
    try:
        from src.backend.realtime.pubsub import check_redis_connection
        await check_redis_connection()
    except Exception as e:
        logging.getLogger("golden_hour").info("Redis check skipped: %s", e)

    yield
    # Shutdown
    print("Golden Hour API shutting down...")


app = FastAPI(
    title="Golden Hour API",
    description="AI-Powered Emergency Response for India",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(speech_router, prefix="/api/v1/speech", tags=["speech"])
app.include_router(triage_router, prefix="/api/v1/triage", tags=["triage"])
app.include_router(dispatch_router, prefix="/api/v1/dispatch", tags=["dispatch"])
app.include_router(notifications_router, prefix="/api/v1/notifications", tags=["notifications"])
app.include_router(pipeline_router, prefix="/api/v1", tags=["pipeline"])
app.include_router(realtime_router, prefix="/api/v1/realtime", tags=["realtime"])


@app.get("/")
async def root():
    return {"service": "Golden Hour API", "version": "0.1.0", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.backend.main:app",
        host="0.0.0.0",
        port=int(os.getenv("APP_PORT", 8000)),
        reload=os.getenv("APP_ENV") == "development",
    )
