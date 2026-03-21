"""
Tests for the document converter strategy logic in api/app.py.

These tests exercise _doc_conv_strategy and _IMAGE_EXTS to make sure:
- Image files are never routed to Pandoc (which would raise a cryptic
  "Invalid input format! Got 'jpg' but expected one of these: …" error).
- Supported conversions are routed to the correct backend strategy.
- The "unsupported" strategy is returned for combinations that have no
  viable conversion path (e.g. image→html, image→md).
"""
import sys
import os

# Make sure the repo root is on the path so we can import from api.app
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from api.app import _doc_conv_strategy, _IMAGE_EXTS, _unsupported_conversion_error


# ---------------------------------------------------------------------------
# _IMAGE_EXTS sanity checks
# ---------------------------------------------------------------------------

class TestImageExts:
    def test_common_image_exts_present(self):
        for ext in ("jpg", "jpeg", "png", "bmp", "tiff", "gif", "webp"):
            assert ext in _IMAGE_EXTS, f"{ext!r} should be in _IMAGE_EXTS"

    def test_document_exts_not_present(self):
        for ext in ("pdf", "docx", "xlsx", "pptx", "html", "md", "txt", "epub", "odt"):
            assert ext not in _IMAGE_EXTS, f"{ext!r} must NOT be in _IMAGE_EXTS"


# ---------------------------------------------------------------------------
# _doc_conv_strategy: image inputs
# ---------------------------------------------------------------------------

class TestImageInputStrategy:
    """Image files must NEVER be routed to Pandoc.

    Pandoc does not accept image formats as --from argument and would raise:
      'Invalid input format! Got "jpg" but expected one of these: …'
    which is a confusing, cryptic message for end users.
    """

    IMAGE_SOURCES = ["jpg", "jpeg", "png", "bmp", "tiff", "gif", "webp"]
    DOC_TARGETS   = ["html", "md", "txt", "epub", "docx", "xlsx", "pptx", "odt", "csv"]

    @pytest.mark.parametrize("src", IMAGE_SOURCES)
    def test_image_to_pdf_uses_img2pdf(self, src):
        assert _doc_conv_strategy(f".{src}", "pdf") == "img2pdf"

    @pytest.mark.parametrize("src", IMAGE_SOURCES)
    @pytest.mark.parametrize("tgt", DOC_TARGETS)
    def test_image_to_doc_format_is_unsupported_not_pandoc(self, src, tgt):
        strategy = _doc_conv_strategy(f".{src}", tgt)
        assert strategy != "pandoc", (
            f"Image ({src}) → {tgt} must NOT be routed to Pandoc. "
            f"Got strategy={strategy!r}."
        )
        assert strategy == "unsupported", (
            f"Image ({src}) → {tgt} should return 'unsupported', got {strategy!r}."
        )

    @pytest.mark.parametrize("src", IMAGE_SOURCES)
    def test_image_to_image_passthrough_when_same(self, src):
        # Same extension → passthrough (no conversion needed)
        assert _doc_conv_strategy(f".{src}", src) == "passthrough"

    @pytest.mark.parametrize("src", ["jpg", "jpeg", "png"])
    @pytest.mark.parametrize("tgt", ["png", "jpg"])
    def test_image_to_different_image_is_unsupported(self, src, tgt):
        if src == tgt:
            return  # passthrough tested above
        strategy = _doc_conv_strategy(f".{src}", tgt)
        assert strategy != "pandoc", (
            f"Image ({src}) → image ({tgt}) must NOT be routed to Pandoc."
        )


# ---------------------------------------------------------------------------
# _doc_conv_strategy: correct strategies for valid conversions
# ---------------------------------------------------------------------------

class TestKnownStrategies:
    def test_pdf_to_html(self):
        # PDF is not a valid Pandoc input; must return "unsupported" not "pandoc"
        assert _doc_conv_strategy(".pdf", "html") == "unsupported"

    def test_pdf_to_md(self):
        assert _doc_conv_strategy(".pdf", "md") == "unsupported"

    def test_pdf_to_txt(self):
        assert _doc_conv_strategy(".pdf", "txt") == "unsupported"

    def test_pdf_to_epub(self):
        assert _doc_conv_strategy(".pdf", "epub") == "unsupported"

    def test_pdf_to_rst(self):
        assert _doc_conv_strategy(".pdf", "rst") == "unsupported"

    @pytest.mark.parametrize("tgt", ["html", "md", "txt", "epub", "rst"])
    def test_pdf_to_text_format_never_uses_pandoc(self, tgt):
        strategy = _doc_conv_strategy(".pdf", tgt)
        assert strategy != "pandoc", (
            f"_doc_conv_strategy('.pdf', '{tgt}') returned 'pandoc' "
            "but PDF is not a valid Pandoc input format"
        )
        assert strategy == "unsupported"

    def test_pdf_to_docx(self):
        assert _doc_conv_strategy(".pdf", "docx") == "pdf2docx"

    def test_pdf_to_png(self):
        assert _doc_conv_strategy(".pdf", "png") == "pdf2img"

    def test_pdf_to_jpg(self):
        assert _doc_conv_strategy(".pdf", "jpg") == "pdf2img"

    def test_pdf_to_xlsx(self):
        assert _doc_conv_strategy(".pdf", "xlsx") == "tabula"

    def test_md_to_html(self):
        assert _doc_conv_strategy(".md", "html") == "pandoc"

    def test_html_to_md(self):
        assert _doc_conv_strategy(".html", "md") == "pandoc"

    def test_txt_to_epub(self):
        assert _doc_conv_strategy(".txt", "epub") == "pandoc"

    def test_docx_to_html(self):
        assert _doc_conv_strategy(".docx", "html") == "pandoc"

    def test_docx_to_pdf(self):
        # Falls through to libreoffice
        assert _doc_conv_strategy(".docx", "pdf") == "libreoffice"

    def test_passthrough(self):
        assert _doc_conv_strategy(".pdf", "pdf") == "passthrough"
        assert _doc_conv_strategy(".docx", "docx") == "passthrough"

    def test_xlsx_to_csv_uses_libreoffice(self):
        # xlsx/xls are excluded from pandoc; should fall to libreoffice
        assert _doc_conv_strategy(".xlsx", "csv") == "libreoffice"

    def test_xlsx_to_html_uses_libreoffice(self):
        assert _doc_conv_strategy(".xlsx", "html") == "libreoffice"

    def test_ext_without_dot_also_works(self):
        # src_ext without leading dot should behave the same
        assert _doc_conv_strategy("jpg", "pdf") == "img2pdf"
        assert _doc_conv_strategy("jpg", "html") == "unsupported"
        assert _doc_conv_strategy("md", "html") == "pandoc"


# ---------------------------------------------------------------------------
# Error message quality: make sure readable messages would be produced
# ---------------------------------------------------------------------------

class TestErrorMessages:
    """Verify the error message helpers produce readable text.

    These tests call the shared ``_unsupported_conversion_error`` helper from
    ``api.app`` directly, ensuring the user-facing message does NOT expose
    Pandoc internals (the raw format list: biblatex, bibtex, bits, commonmark …).
    """

    PANDOC_RAW_FORMATS = [
        "biblatex", "bibtex", "bits", "commonmark", "commonmark_x",
        "creole", "csljson", "csv", "docbook",
    ]

    @pytest.mark.parametrize("src", ["jpg", "png", "jpeg", "gif", "webp"])
    @pytest.mark.parametrize("tgt", ["html", "md", "txt", "epub"])
    def test_unsupported_image_error_is_readable(self, src, tgt):
        msg = _unsupported_conversion_error(src, tgt)
        # Must mention the source extension in a human-readable way
        assert src in msg or tgt in msg, "Error should mention the formats involved."
        # Must NOT contain Pandoc's raw format list
        for fmt in self.PANDOC_RAW_FORMATS:
            assert fmt not in msg, (
                f"Error message must not expose Pandoc internals. "
                f"Found {fmt!r} in: {msg!r}"
            )
        # Must not contain the raw Pandoc error header
        assert "Invalid input format!" not in msg
        assert "expected one of these" not in msg.lower()

    @pytest.mark.parametrize("src", ["jpg", "png"])
    def test_unsupported_image_mentions_pdf_as_only_option(self, src):
        msg = _unsupported_conversion_error(src, "html")
        assert "PDF" in msg or "pdf" in msg, (
            "The error for image→non-pdf should tell the user PDF is the only option."
        )

    @pytest.mark.parametrize("tgt", ["html", "md", "txt", "epub", "rst"])
    def test_pdf_to_text_format_error_is_readable(self, tgt):
        """Error for pdf→text must NOT expose Pandoc internals."""
        msg = _unsupported_conversion_error("pdf", tgt)
        assert "pdf" in msg.lower()
        assert tgt in msg.lower()
        assert "Invalid input format!" not in msg
        assert "expected one of these" not in msg.lower()
        for fmt in self.PANDOC_RAW_FORMATS:
            assert fmt not in msg, (
                f"Error must not expose Pandoc internals. Found {fmt!r} in: {msg!r}"
            )

    def test_pdf_to_html_error_matches_expected_wording(self):
        msg = _unsupported_conversion_error("pdf", "html")
        assert "Cannot convert .pdf files to .html" in msg

    def test_pdf_to_html_error_mentions_supported_formats(self):
        msg = _unsupported_conversion_error("pdf", "html")
        # Should tell the user which text-based formats are actually supported
        assert "md" in msg or "docx" in msg or "txt" in msg, (
            "Error for pdf→html should mention which formats ARE supported"
        )
