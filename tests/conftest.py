"""Shared test fixtures.

DB tests are skipped automatically if TEST_DATABASE_URL is not set.
"""

import os

import pytest


requires_db = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"),
    reason="TEST_DATABASE_URL not set — skipping DB integration tests",
)
