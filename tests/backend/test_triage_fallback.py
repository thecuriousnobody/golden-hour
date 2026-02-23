"""Tests for the multi-tier triage fallback chain."""

import pytest
import asyncio

from src.backend.triage.engine import (
    run_triage,
    _keyword_fallback,
    TriageAssessment,
    ExtractedSymptom,
)


class TestTriageFallbackChain:
    """Test the Claude -> Gemini -> keyword fallback chain."""

    def test_keyword_fallback_cardiac(self):
        """Keyword fallback correctly identifies cardiac emergencies."""
        result = _keyword_fallback("He grabbed his chest and fell down, not breathing")
        assert result.severity == "CRITICAL"
        assert result.esi_level == 1
        assert result.triage_score == 10
        assert "cath_lab" in result.required_capabilities or "icu" in result.required_capabilities
        assert result.triage_source == "keyword"
        assert result.confidence == 0.6

    def test_keyword_fallback_stroke(self):
        """Keyword fallback correctly identifies stroke."""
        result = _keyword_fallback("Her face is drooping on one side, slurred speech")
        assert result.severity == "CRITICAL"
        assert "stroke_unit" in result.required_capabilities or "ct_scan" in result.required_capabilities
        assert result.triage_source == "keyword"

    def test_keyword_fallback_snakebite(self):
        """Keyword fallback correctly identifies snakebite."""
        result = _keyword_fallback("A snake bit my child")
        assert result.severity == "HIGH"
        assert "antivenom" in result.required_capabilities
        assert result.triage_source == "keyword"

    def test_keyword_fallback_no_match(self):
        """Unknown emergency defaults to moderate."""
        result = _keyword_fallback("Something is wrong please help")
        assert result.severity == "MODERATE"
        assert result.esi_level == 3
        assert result.triage_source == "keyword"
        assert result.confidence == 0.3

    def test_keyword_fallback_merges_capabilities(self):
        """Multiple keyword matches should merge capabilities."""
        result = _keyword_fallback("He has chest pain and is not breathing, head injury too")
        # Should have capabilities from cardiac + respiratory + head injury rules
        assert len(result.required_capabilities) > 2

    def test_new_fields_have_defaults(self):
        """New fields should have sensible defaults for backward compatibility."""
        result = _keyword_fallback("Chest pain")
        assert isinstance(result.differential_diagnoses, list)
        assert isinstance(result.recommended_first_aid, list)
        assert isinstance(result.confidence, float)
        assert result.disclaimer == "AI-assisted triage — not a medical diagnosis."
        assert result.clinical_reasoning != ""

    def test_run_triage_falls_back_to_keywords(self):
        """Without API keys, run_triage should fall back to keywords."""
        # In test environment, no API keys are set
        result = asyncio.get_event_loop().run_until_complete(
            run_triage("severe chest pain and sweating")
        )
        assert isinstance(result, TriageAssessment)
        assert result.severity in ["CRITICAL", "HIGH", "MODERATE", "LOW"]
        assert 1 <= result.esi_level <= 5

    def test_extracted_symptom_new_fields(self):
        """ExtractedSymptom should support body_system and onset."""
        symptom = ExtractedSymptom(
            key="Symptom",
            value="Chest pain",
            critical=True,
            body_system="cardiac",
            onset="acute",
        )
        assert symptom.body_system == "cardiac"
        assert symptom.onset == "acute"

    def test_extracted_symptom_defaults(self):
        """ExtractedSymptom defaults should work for backward compat."""
        symptom = ExtractedSymptom(key="Symptom", value="Pain", critical=False)
        assert symptom.body_system == "general"
        assert symptom.onset == "unknown"
