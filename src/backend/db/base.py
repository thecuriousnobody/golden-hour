"""SQLAlchemy 2.0 async engine, session factory, and Base.

All database access is optional — if DATABASE_URL is not set, get_db() raises
a clear error and the rest of the system operates without persistence.
"""

import os
import logging

from sqlalchemy import text
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger("golden_hour.db")

DATABASE_URL = os.getenv("DATABASE_URL", "")

# Convert psycopg2/sync URL to asyncpg URL if needed
_async_url = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://").replace(
    "postgresql+psycopg2://", "postgresql+asyncpg://"
) if DATABASE_URL else ""

engine = create_async_engine(_async_url, echo=False, pool_pre_ping=True) if _async_url else None

async_session_factory = async_sessionmaker(engine, expire_on_commit=False) if engine else None


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — yields an async DB session.

    Usage:
        @router.get("/example")
        async def example(db: AsyncSession = Depends(get_db)):
            ...
    """
    if async_session_factory is None:
        raise RuntimeError(
            "Database not configured. Set DATABASE_URL environment variable."
        )
    async with async_session_factory() as session:
        yield session


async def check_db_connection() -> bool:
    """Non-blocking DB connection test. Returns True if connected, False otherwise."""
    if engine is None:
        logger.info("DATABASE_URL not set — running without database")
        return False
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("Database connection OK")
        return True
    except Exception as e:
        logger.warning("Database connection failed (non-blocking): %s", e)
        return False
