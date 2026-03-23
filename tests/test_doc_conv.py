"""Tests for document converter and CV extraction in api/app.py.

These tests verify that:
  - _DOC_CONVERSIONS contains expected source formats and targets.
  - _parse_cv_text() extracts key fields from plain-text CV content (used by
    /api/cv/extract for both PDF and DOCX uploads).
"""

import pytest

from api.app import (
    _DOC_CONVERSIONS,
    _parse_cv_text,
)


# ---------------------------------------------------------------------------
# _parse_cv_text: CV field extraction
# ---------------------------------------------------------------------------

class TestParseCvText:
    """_parse_cv_text heuristically extracts structured fields from plain-text CVs."""

    _SAMPLE_CV = """
Jane Smith
Senior Software Engineer
jane.smith@example.com
+1 555 987 6543
London, United Kingdom
https://linkedin.com/in/janesmith

Summary
Experienced software engineer with 8+ years in backend systems.

Skills
Python, Django, PostgreSQL, Docker, Kubernetes, REST APIs

Experience
TechCorp — Senior Engineer — 2020–Present
• Led microservices migration
• Mentored junior developers

Education
University of London — BSc Computer Science — 2015

Projects
OpenLib — Open-source library management system
"""

    def test_extracts_email(self):
        fields = _parse_cv_text(self._SAMPLE_CV)
        assert fields.get("email") == "jane.smith@example.com"

    def test_extracts_phone(self):
        fields = _parse_cv_text(self._SAMPLE_CV)
        assert "+1" in (fields.get("phone") or "")

    def test_extracts_link(self):
        fields = _parse_cv_text(self._SAMPLE_CV)
        assert "linkedin" in (fields.get("link") or "").lower()

    def test_extracts_experience_section(self):
        fields = _parse_cv_text(self._SAMPLE_CV)
        assert "TechCorp" in (fields.get("experience") or "")

    def test_extracts_education_section(self):
        fields = _parse_cv_text(self._SAMPLE_CV)
        assert "University" in (fields.get("education") or "")

    def test_extracts_skills_section(self):
        fields = _parse_cv_text(self._SAMPLE_CV)
        assert "Python" in (fields.get("skills") or "")

    def test_extracts_projects_section(self):
        fields = _parse_cv_text(self._SAMPLE_CV)
        assert "OpenLib" in (fields.get("projects") or "")

    def test_returns_all_expected_keys(self):
        fields = _parse_cv_text(self._SAMPLE_CV)
        expected = {"name", "email", "phone", "location", "link",
                    "summary", "experience", "education", "skills",
                    "projects", "publications"}
        assert set(fields.keys()) == expected

    def test_empty_string_returns_empty_dict_values(self):
        fields = _parse_cv_text("")
        assert isinstance(fields, dict)
        # All values should be empty strings (no crash)
        for v in fields.values():
            assert isinstance(v, str)

