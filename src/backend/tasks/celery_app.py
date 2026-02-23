"""Celery application configuration.

Optional — if REDIS_URL is not set, tasks run synchronously via .apply()
or are simply skipped. The system works without Celery.

Beat schedule:
- check_stale_dispatches: every 60 seconds
- expire_location_sharing: every 5 minutes
"""

import os
import logging

logger = logging.getLogger("golden_hour.tasks")

_celery_app = None

REDIS_URL = os.getenv("REDIS_URL", "")


def get_celery_app():
    """Get or create the Celery app. Returns None if Redis unavailable."""
    global _celery_app

    if _celery_app is not None:
        return _celery_app

    if not REDIS_URL:
        logger.info("REDIS_URL not set — Celery tasks disabled")
        return None

    try:
        from celery import Celery
        from celery.schedules import crontab

        _celery_app = Celery(
            "golden_hour",
            broker=REDIS_URL,
            backend=REDIS_URL,
        )

        _celery_app.conf.update(
            task_serializer="json",
            accept_content=["json"],
            result_serializer="json",
            timezone="UTC",
            enable_utc=True,
            task_track_started=True,
            task_time_limit=300,  # 5 min hard limit
            task_soft_time_limit=240,  # 4 min soft limit
            worker_prefetch_multiplier=1,  # Fair scheduling
        )

        # Beat schedule
        _celery_app.conf.beat_schedule = {
            "check-stale-dispatches": {
                "task": "src.backend.tasks.monitoring.check_stale_dispatches",
                "schedule": 60.0,  # Every 60 seconds
            },
            "expire-location-sharing": {
                "task": "src.backend.tasks.monitoring.expire_location_sharing",
                "schedule": 300.0,  # Every 5 minutes
            },
        }

        logger.info("Celery app configured with Redis broker")
        return _celery_app

    except ImportError:
        logger.info("Celery not installed — background tasks disabled")
        return None
    except Exception as e:
        logger.warning("Celery setup failed: %s", e)
        return None


def schedule_task(task_name: str, args: tuple = (), kwargs: dict = None, countdown: int = 0) -> bool:
    """Schedule a Celery task. Returns False if Celery unavailable.

    Usage:
        schedule_task(
            "src.backend.tasks.escalation.escalation_timer",
            kwargs={"session_id": "gh_abc123"},
            countdown=120,  # 2 minutes
        )
    """
    app = get_celery_app()
    if app is None:
        logger.debug("Celery unavailable — skipping task %s", task_name)
        return False

    try:
        app.send_task(task_name, args=args, kwargs=kwargs or {}, countdown=countdown)
        logger.info("Scheduled task %s (countdown=%ds)", task_name, countdown)
        return True
    except Exception as e:
        logger.error("Failed to schedule task %s: %s", task_name, e)
        return False
