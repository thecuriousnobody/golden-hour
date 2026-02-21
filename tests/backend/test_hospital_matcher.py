"""Tests for the hospital capability matching engine."""

import pytest

from src.backend.dispatch.hospital_matcher import (
    haversine_km,
    load_hospitals,
    get_hospitals,
    match_hospitals,
    get_best_hospital,
    Hospital,
)


@pytest.fixture(autouse=True)
def setup_hospitals():
    """Ensure hospitals are loaded before each test."""
    load_hospitals()


class TestHaversine:
    def test_same_point(self):
        assert haversine_km(12.9716, 77.5946, 12.9716, 77.5946) == 0.0

    def test_known_distance(self):
        # Bangalore MG Road to Bannerghatta — roughly 10-11km
        dist = haversine_km(12.9816, 77.5920, 12.8891, 77.5970)
        assert 10 < dist < 12

    def test_symmetry(self):
        d1 = haversine_km(12.97, 77.59, 12.89, 77.60)
        d2 = haversine_km(12.89, 77.60, 12.97, 77.59)
        assert abs(d1 - d2) < 0.001


class TestHospitalLoading:
    def test_hospitals_loaded(self):
        hospitals = get_hospitals()
        assert len(hospitals) >= 2

    def test_hospital_has_required_fields(self):
        hospitals = get_hospitals()
        for h in hospitals:
            assert h.id
            assert h.name
            assert h.capabilities
            assert h.lat != 0.0
            assert h.lng != 0.0


class TestCapabilityMatching:
    def test_cardiac_matches_cath_lab(self):
        """Cardiac emergency should match hospitals with cath_lab."""
        matches = match_hospitals(
            required_capabilities=["cath_lab", "icu"],
            caller_lat=12.9716,
            caller_lng=77.5946,
        )
        assert len(matches) > 0
        best = matches[0]
        assert "cath_lab" in best.matched_capabilities
        assert best.capability_score > 0

    def test_snakebite_matches_antivenom(self):
        """Snakebite should find hospitals with antivenom."""
        matches = match_hospitals(
            required_capabilities=["antivenom"],
            caller_lat=12.9716,
            caller_lng=77.5946,
        )
        assert len(matches) > 0
        # At least one hospital should have antivenom (Victoria Hospital)
        has_antivenom = any(m.capability_score == 1.0 for m in matches)
        assert has_antivenom

    def test_capability_score_ranking(self):
        """Hospital with more matching capabilities should rank higher."""
        matches = match_hospitals(
            required_capabilities=["cath_lab", "icu", "stroke_unit", "ct_scan"],
            caller_lat=12.9716,
            caller_lng=77.5946,
        )
        assert len(matches) >= 2
        # First match should have equal or better capability score than second
        assert matches[0].overall_score >= matches[1].overall_score

    def test_no_capabilities_matches_all(self):
        """No specific capabilities → any hospital matches."""
        matches = match_hospitals(
            required_capabilities=[],
            caller_lat=12.9716,
            caller_lng=77.5946,
        )
        assert len(matches) > 0
        for m in matches:
            assert m.capability_score == 1.0

    def test_max_distance_filter(self):
        """Hospitals beyond max_distance_km should be excluded."""
        matches = match_hospitals(
            required_capabilities=["icu"],
            caller_lat=12.9716,
            caller_lng=77.5946,
            max_distance_km=1.0,
        )
        for m in matches:
            assert m.distance_km <= 1.0

    def test_get_best_hospital(self):
        """get_best_hospital returns the top match."""
        best = get_best_hospital(
            required_capabilities=["cath_lab"],
            caller_lat=12.9716,
            caller_lng=77.5946,
        )
        assert best is not None
        assert best.hospital.name
        assert best.distance_km > 0

    def test_neurosurgery_matches_nimhans(self):
        """Neurosurgery requirement should match NIMHANS."""
        matches = match_hospitals(
            required_capabilities=["neurosurgery"],
            caller_lat=12.9500,
            caller_lng=77.5900,
        )
        # NIMHANS should be among matches
        nimhans_matches = [m for m in matches if "nimhans" in m.hospital.id.lower()]
        assert len(nimhans_matches) > 0
