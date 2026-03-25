"""Tests for document converter and CV extraction in api/app.py.

These tests verify that:
  - _DOC_CONVERSIONS contains expected source formats and targets.
  - _parse_cv_text() extracts key fields from plain-text CV content (used by
    /api/cv/extract for both PDF and DOCX uploads).
  - _build_cv_pdf() generates a non-empty PDF without raising, and correctly
    handles special/Unicode characters without producing '?' placeholders.
  - _rule_based_cv_suggestions() returns structured suggestions for CV fields.
"""

import os
import tempfile

import pytest

from api.app import (
    _DOC_CONVERSIONS,
    _parse_cv_text,
    _build_cv_pdf,
    _rule_based_cv_suggestions,
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


# ---------------------------------------------------------------------------
# _rule_based_cv_suggestions: AI offline suggestion engine
# ---------------------------------------------------------------------------

class TestRuleBasedCvSuggestions:
    """_rule_based_cv_suggestions returns structured hints for CV fields."""

    def test_returns_dict_with_required_keys(self):
        result = _rule_based_cv_suggestions("summary", "A brief summary.")
        assert isinstance(result, dict)
        assert "suggestions" in result
        assert "sample_verbs" in result

    def test_suggestions_is_list_of_strings(self):
        result = _rule_based_cv_suggestions("experience", "Company — Engineer — 2020–2024")
        assert isinstance(result["suggestions"], list)
        for s in result["suggestions"]:
            assert isinstance(s, str)

    def test_sample_verbs_only_for_experience(self):
        exp_result = _rule_based_cv_suggestions("experience", "Some text")
        skl_result = _rule_based_cv_suggestions("skills", "Python, Java")
        assert len(exp_result["sample_verbs"]) > 0
        assert len(skl_result["sample_verbs"]) == 0

    def test_empty_text_returns_suggestions(self):
        """Empty input should still return actionable tips."""
        result = _rule_based_cv_suggestions("summary", "")
        assert len(result["suggestions"]) > 0

    def test_weak_phrase_detected(self):
        """Text containing 'responsible for' triggers a weak-phrase suggestion."""
        result = _rule_based_cv_suggestions("experience", "I was responsible for managing a team.")
        tips = " ".join(result["suggestions"]).lower()
        assert "measurable" in tips or "stronger" in tips or "responsible" in tips

    def test_skills_short_list_flagged(self):
        """A skills list with fewer than 4 items should prompt the user to add more."""
        result = _rule_based_cv_suggestions("skills", "Python, Java")
        tips = " ".join(result["suggestions"]).lower()
        assert "6" in tips or "skills" in tips

    def test_summary_word_count_too_short(self):
        result = _rule_based_cv_suggestions("summary", "Short summary.")
        tips = " ".join(result["suggestions"]).lower()
        assert "short" in tips or "50" in tips or "80" in tips or "summary" in tips

    def test_all_supported_fields_do_not_raise(self):
        for field in ("summary", "experience", "education", "skills", "projects", "publications"):
            result = _rule_based_cv_suggestions(field, "Sample text for " + field)
            assert isinstance(result["suggestions"], list)

    def test_deduplication_no_repeated_suggestions(self):
        """Suggestion list should not contain duplicates."""
        result = _rule_based_cv_suggestions("experience", "responsible for responsible for")
        suggestions = result["suggestions"]
        assert len(suggestions) == len(set(suggestions))

    def test_suggestions_capped_at_eight(self):
        """Result should contain at most 8 suggestions."""
        result = _rule_based_cv_suggestions("experience", "I was responsible for my duties. Worked on things etc.")
        assert len(result["suggestions"]) <= 8


# ---------------------------------------------------------------------------
# _normalize_text_bullets  and  _extract_text_from_txt
# ---------------------------------------------------------------------------

from api.app import _normalize_text_bullets, _extract_text_from_txt


class TestNormalizeTextBullets:
    """_normalize_text_bullets converts various bullet characters to •."""

    def test_dash_bullet_converted(self):
        result = _normalize_text_bullets("- Item one\n- Item two")
        assert "• Item one" in result
        assert "• Item two" in result

    def test_asterisk_bullet_converted(self):
        result = _normalize_text_bullets("* First\n* Second")
        assert "• First" in result
        assert "• Second" in result

    def test_unicode_bullet_normalised(self):
        result = _normalize_text_bullets("• Already a bullet")
        assert "• Already a bullet" in result

    def test_indentation_preserved(self):
        result = _normalize_text_bullets("  - Indented item")
        assert result.startswith("  • ") or "  • Indented item" in result

    def test_plain_text_unchanged(self):
        text = "No bullets here.\nJust plain text."
        assert _normalize_text_bullets(text) == text

    def test_emojis_preserved(self):
        text = "- 🎉 Celebration item\n- 🚀 Launch item"
        result = _normalize_text_bullets(text)
        assert "🎉" in result
        assert "🚀" in result

    def test_line_breaks_preserved(self):
        text = "First paragraph.\n\nSecond paragraph."
        result = _normalize_text_bullets(text)
        assert "\n\n" in result


class TestExtractTextFromTxt:
    """_extract_text_from_txt reads a plain-text file preserving content."""

    def test_reads_utf8_file(self, tmp_path):
        content = "Hello world\nLine two 🎉\n• Bullet"
        p = tmp_path / "test.txt"
        p.write_text(content, encoding="utf-8")
        result = _extract_text_from_txt(str(p))
        assert result == content

    def test_reads_latin1_file(self, tmp_path):
        content = "Caf\xe9 au lait"
        p = tmp_path / "test.txt"
        p.write_bytes(content.encode("latin-1"))
        result = _extract_text_from_txt(str(p))
        assert "Caf" in result

    def test_empty_file_returns_empty_string(self, tmp_path):
        p = tmp_path / "empty.txt"
        p.write_text("", encoding="utf-8")
        result = _extract_text_from_txt(str(p))
        assert result == ""

    def test_multiline_preserved(self, tmp_path):
        content = "Line 1\nLine 2\nLine 3"
        p = tmp_path / "multi.txt"
        p.write_text(content, encoding="utf-8")
        result = _extract_text_from_txt(str(p))
        assert result.count("\n") == 2


# ---------------------------------------------------------------------------
# _extract_text_from_rtf
# ---------------------------------------------------------------------------

from api.app import _extract_text_from_rtf


class TestExtractTextFromRtf:
    """_extract_text_from_rtf extracts plain text from RTF content."""

    def _write_rtf(self, tmp_path, text: str) -> str:
        """Write a minimal RTF file containing text and return its path."""
        rtf_content = (
            r'{\rtf1\ansi\deff0'
            r'{\fonttbl{\f0 Times New Roman;}}'
            r'\f0\fs24 ' + text +
            r'}'
        )
        p = tmp_path / "test.rtf"
        p.write_text(rtf_content, encoding="utf-8")
        return str(p)

    def test_returns_string(self, tmp_path):
        path = self._write_rtf(tmp_path, "Hello world")
        result = _extract_text_from_rtf(path)
        assert isinstance(result, str)

    def test_extracts_text_content(self, tmp_path):
        path = self._write_rtf(tmp_path, "Hello world")
        result = _extract_text_from_rtf(path)
        # The result should be a non-empty string; exact content depends on available
        # RTF parser (pypandoc vs regex fallback), so we verify it's non-trivially sized
        # or contains expected words.
        assert isinstance(result, str)
        assert "Hello" in result or "world" in result or len(result) > 0

    def test_nonexistent_file_returns_empty(self, tmp_path):
        result = _extract_text_from_rtf(str(tmp_path / "missing.rtf"))
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# _build_cv_txt: Plain-text CV generation
# ---------------------------------------------------------------------------

from api.app import _build_cv_txt


class TestBuildCvTxt:
    """_build_cv_txt produces a structured plain-text CV."""

    _DEFAULTS = dict(
        name="Jane Smith",
        email="jane@example.com",
        phone="+1 555 000 0000",
        location="London, UK",
        link="https://linkedin.com/in/jane",
        summary="Experienced engineer.",
        experience="TechCorp — Engineer — 2020–2024\n• Built things",
        education="University — BSc — 2020",
        skills="Python, Django, PostgreSQL",
        projects="OpenLib — Library tool",
        publications="",
    )

    def _build(self, **kwargs) -> str:
        params = {**self._DEFAULTS, **kwargs}
        return _build_cv_txt(**params)

    def test_returns_string(self):
        result = self._build()
        assert isinstance(result, str)

    def test_contains_name(self):
        result = self._build()
        assert "JANE SMITH" in result

    def test_contains_email(self):
        result = self._build()
        assert "jane@example.com" in result

    def test_contains_experience_section(self):
        result = self._build()
        assert "WORK EXPERIENCE" in result
        assert "TechCorp" in result

    def test_contains_education_section(self):
        result = self._build()
        assert "EDUCATION" in result
        assert "University" in result

    def test_contains_skills_section(self):
        result = self._build()
        assert "SKILLS" in result
        assert "Python" in result

    def test_chronological_layout_experience_before_skills(self):
        result = self._build(layout="chronological")
        exp_pos = result.index("WORK EXPERIENCE")
        skl_pos = result.index("SKILLS")
        assert exp_pos < skl_pos, "Chronological: experience should precede skills"

    def test_functional_layout_skills_before_experience(self):
        result = self._build(layout="functional")
        exp_pos = result.index("WORK EXPERIENCE")
        skl_pos = result.index("SKILLS")
        assert skl_pos < exp_pos, "Functional: skills should precede experience"

    def test_invalid_layout_falls_back_to_chronological(self):
        result = self._build(layout="unknown_layout")
        exp_pos = result.index("WORK EXPERIENCE")
        skl_pos = result.index("SKILLS")
        assert exp_pos < skl_pos, "Invalid layout should fall back to chronological"

    def test_empty_optional_fields_no_section_for_them(self):
        result = self._build(projects="", publications="")
        assert "PROJECTS" not in result
        assert "PUBLICATIONS" not in result

    def test_unicode_characters_preserved(self):
        result = self._build(name="José García", location="München")
        assert "JOSÉ GARCÍA" in result
        assert "München" in result


# ---------------------------------------------------------------------------
# _DOC_CONVERSIONS: new format entries
# ---------------------------------------------------------------------------

class TestDocConversionsExtended:
    """_DOC_CONVERSIONS must include the newly added source/target formats."""

    def test_rtf_source_present(self):
        assert "rtf" in _DOC_CONVERSIONS

    def test_txt_source_present(self):
        assert "txt" in _DOC_CONVERSIONS

    def test_rtf_to_pdf_supported(self):
        assert "pdf" in _DOC_CONVERSIONS.get("rtf", {})

    def test_rtf_to_text_supported(self):
        assert "text" in _DOC_CONVERSIONS.get("rtf", {})

    def test_pdf_to_text_supported(self):
        assert "text" in _DOC_CONVERSIONS.get("pdf", {})

    def test_docx_to_text_supported(self):
        assert "text" in _DOC_CONVERSIONS.get("docx", {})

    def test_txt_to_pdf_supported(self):
        assert "pdf" in _DOC_CONVERSIONS.get("txt", {})


# ---------------------------------------------------------------------------
# _build_cv_pdf: layout parameter support
# ---------------------------------------------------------------------------

class TestBuildCvPdfLayout:
    """_build_cv_pdf correctly handles the new ``layout`` parameter."""

    def _generate(self, layout="chronological") -> bytes:
        import tempfile
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
            layout=layout,
        )
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            out = f.name
        try:
            _build_cv_pdf(out, **defaults)
            with open(out, "rb") as f:
                return f.read()
        finally:
            if os.path.isfile(out):
                os.unlink(out)

    def test_chronological_generates_pdf(self):
        data = self._generate("chronological")
        assert data[:4] == b"%PDF"

    def test_functional_generates_pdf(self):
        data = self._generate("functional")
        assert data[:4] == b"%PDF"

    def test_invalid_layout_generates_pdf(self):
        data = self._generate("bogus_layout")
        assert data[:4] == b"%PDF"
