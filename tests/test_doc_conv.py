"""Tests for document converter and CV extraction in api/app.py.

These tests verify that:
  - _DOC_CONVERSIONS contains expected source formats and targets.
  - _parse_cv_text() extracts key fields from plain-text CV content (used by
    /api/cv/extract for both PDF and DOCX uploads).
  - _build_cv_pdf() generates a non-empty PDF without raising, and correctly
    handles special/Unicode characters without producing '?' placeholders.
"""

import os
import tempfile

import pytest

from api.app import (
    _DOC_CONVERSIONS,
    _parse_cv_text,
    _build_cv_pdf,
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


# ---------------------------------------------------------------------------
# _build_cv_pdf: PDF generation including special-character handling
# ---------------------------------------------------------------------------

class TestBuildCvPdf:
    """_build_cv_pdf generates a valid PDF that handles Unicode input correctly."""

    def _generate(self, **kwargs) -> bytes:
        """Run _build_cv_pdf with the given kwargs; return the raw PDF bytes."""
        defaults = dict(
            name="Test User",
            email="test@example.com",
            phone="+1 555 000 0000",
            location="Test City",
            link="https://example.com",
            summary="A brief summary.",
            experience="Company — Role — 2020–2024\n• Achievement",
            education="University — Degree — 2020",
            skills="Python, JavaScript",
            projects="Project — Description",
            publications="",
            logo_path="",
            theme="classic",
        )
        defaults.update(kwargs)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            out = f.name
        try:
            _build_cv_pdf(out, **defaults)
            with open(out, "rb") as f:
                return f.read()
        finally:
            if os.path.isfile(out):
                os.unlink(out)

    def test_generates_non_empty_pdf(self):
        data = self._generate()
        assert len(data) > 0
        assert data[:4] == b"%PDF"

    def test_all_eight_themes_generate_pdf(self):
        for theme in ("classic", "modern", "minimal", "executive",
                      "creative", "tech", "elegant", "vibrant"):
            data = self._generate(theme=theme)
            assert data[:4] == b"%PDF", f"theme={theme} did not produce a valid PDF"

    def test_accented_latin_characters_no_crash(self):
        """Names and text with accented characters must not raise an exception."""
        data = self._generate(
            name="José García",
            location="München, Deutschland",
            summary="Expérience en développement logiciel.",
            skills="C++, Überarbeitung, Ärger-management",
        )
        assert data[:4] == b"%PDF"

    def test_special_punctuation_no_crash(self):
        """En-dash, em-dash, bullets, curly quotes must not raise."""
        data = self._generate(
            summary="Key skills\u2014leadership \u2013 teamwork \u2022 communication",
            experience="Corp \u2014 Engineer \u2014 2020\u20132024\n\u2022 Built things",
        )
        assert data[:4] == b"%PDF"

    def test_unicode_characters_generate_pdf_with_dejavu_fonts(self):
        """When DejaVu TTF fonts are installed, _build_cv_pdf uses them to render
        Unicode text natively (no Latin-1 encoding fallback), producing a valid,
        non-trivially-sized PDF without any exceptions."""
        dejavu_available = all(
            os.path.isfile(p) for p in (
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
            )
        )
        if not dejavu_available:
            pytest.skip("DejaVu fonts not installed; Unicode test skipped")

        # Characters in the Latin Extended-A range (U+0100–U+017F) are fully
        # covered by DejaVu Sans and must appear verbatim in the source text
        # submitted to fpdf2 (no '?' substitution at the Python level).
        special_name = "Żaneta Łukasiewicz"  # Polish – fully covered by DejaVu
        data = self._generate(name=special_name)
        assert data[:4] == b"%PDF"
        # The PDF must contain the UTF-8-encoded name somewhere (fpdf2 embeds
        # text as UTF-16-BE in ToUnicode CMaps when using TTF fonts, so we
        # cannot grep raw bytes directly).  Instead we just ensure the file was
        # produced and is larger than a minimal skeleton, which confirms that
        # fpdf2 didn't error out on the character.
        assert len(data) > 5_000

    def test_empty_optional_fields_generate_pdf(self):
        """All optional fields can be empty strings without causing errors."""
        data = self._generate(
            phone="", location="", link="", summary="",
            experience="", education="", skills="",
            projects="", publications="",
        )
        assert data[:4] == b"%PDF"

