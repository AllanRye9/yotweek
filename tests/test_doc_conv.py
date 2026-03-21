"""Tests for document-conversion strategy logic in api/app.py.

These tests exercise _doc_conv_strategy() and the related _IMAGE_EXTS set to
confirm that:
  - image files are never routed to pandoc (the original bug)
  - image -> pdf uses the img2pdf strategy
  - pdf -> image uses the pdf2img strategy
  - markdown/html/txt paths use pandoc (not libreoffice) for document inputs
  - xlsx/xls are excluded from pandoc and use libreoffice
  - same-format conversions are passthroughs
"""

from api.app import _doc_conv_strategy, _IMAGE_EXTS


# ---------------------------------------------------------------------------
# _IMAGE_EXTS membership
# ---------------------------------------------------------------------------

def test_image_exts_contains_common_formats():
    for ext in ("jpg", "jpeg", "png", "bmp", "tiff", "tif", "gif", "webp"):
        assert ext in _IMAGE_EXTS, f"Expected '{ext}' in _IMAGE_EXTS"


def test_image_exts_excludes_document_formats():
    for ext in ("pdf", "docx", "html", "txt", "md", "epub", "odt", "xlsx"):
        assert ext not in _IMAGE_EXTS, f"'{ext}' should NOT be in _IMAGE_EXTS"


# ---------------------------------------------------------------------------
# Image -> document conversions must NEVER go to pandoc
# ---------------------------------------------------------------------------

def test_jpg_to_html_is_unsupported():
    assert _doc_conv_strategy(".jpg", "html") == "unsupported"


def test_jpg_to_txt_is_unsupported():
    assert _doc_conv_strategy(".jpg", "txt") == "unsupported"


def test_png_to_md_is_unsupported():
    assert _doc_conv_strategy(".png", "md") == "unsupported"


def test_png_to_epub_is_unsupported():
    assert _doc_conv_strategy(".png", "epub") == "unsupported"


def test_jpeg_to_docx_is_unsupported():
    assert _doc_conv_strategy(".jpeg", "docx") == "unsupported"


def test_bmp_to_odt_is_unsupported():
    assert _doc_conv_strategy(".bmp", "odt") == "unsupported"


def test_gif_to_html_is_unsupported():
    assert _doc_conv_strategy(".gif", "html") == "unsupported"


def test_webp_to_txt_is_unsupported():
    assert _doc_conv_strategy(".webp", "txt") == "unsupported"


# Ensure none of these return "pandoc"
def test_no_image_format_routes_to_pandoc():
    document_targets = ("html", "md", "txt", "epub", "docx", "odt", "pdf", "xlsx")
    for img_ext in _IMAGE_EXTS:
        for tgt in document_targets:
            strategy = _doc_conv_strategy(f".{img_ext}", tgt)
            assert strategy != "pandoc", (
                f"_doc_conv_strategy('.{img_ext}', '{tgt}') returned 'pandoc' "
                "but images are not valid pandoc input"
            )


# ---------------------------------------------------------------------------
# Image -> PDF must use img2pdf
# ---------------------------------------------------------------------------

def test_jpg_to_pdf_uses_img2pdf():
    assert _doc_conv_strategy(".jpg", "pdf") == "img2pdf"


def test_png_to_pdf_uses_img2pdf():
    assert _doc_conv_strategy(".png", "pdf") == "img2pdf"


def test_jpeg_to_pdf_uses_img2pdf():
    assert _doc_conv_strategy(".jpeg", "pdf") == "img2pdf"


def test_bmp_to_pdf_uses_img2pdf():
    assert _doc_conv_strategy(".bmp", "pdf") == "img2pdf"


def test_tiff_to_pdf_uses_img2pdf():
    assert _doc_conv_strategy(".tiff", "pdf") == "img2pdf"


# ---------------------------------------------------------------------------
# PDF -> image must use pdf2img
# ---------------------------------------------------------------------------

def test_pdf_to_jpg_uses_pdf2img():
    assert _doc_conv_strategy(".pdf", "jpg") == "pdf2img"


def test_pdf_to_png_uses_pdf2img():
    assert _doc_conv_strategy(".pdf", "png") == "pdf2img"


# ---------------------------------------------------------------------------
# PDF -> DOCX must use pdf2docx
# ---------------------------------------------------------------------------

def test_pdf_to_docx_uses_pdf2docx():
    assert _doc_conv_strategy(".pdf", "docx") == "pdf2docx"


# ---------------------------------------------------------------------------
# PDF -> XLSX must use tabula
# ---------------------------------------------------------------------------

def test_pdf_to_xlsx_uses_tabula():
    assert _doc_conv_strategy(".pdf", "xlsx") == "tabula"


# ---------------------------------------------------------------------------
# Document -> text/markup conversions use pandoc
# ---------------------------------------------------------------------------

def test_docx_to_html_uses_pandoc():
    assert _doc_conv_strategy(".docx", "html") == "pandoc"


def test_docx_to_md_uses_pandoc():
    assert _doc_conv_strategy(".docx", "md") == "pandoc"


def test_docx_to_txt_uses_pandoc():
    assert _doc_conv_strategy(".docx", "txt") == "pandoc"


def test_odt_to_html_uses_pandoc():
    assert _doc_conv_strategy(".odt", "html") == "pandoc"


def test_html_to_docx_uses_pandoc():
    assert _doc_conv_strategy(".html", "docx") == "pandoc"


def test_md_to_html_uses_pandoc():
    assert _doc_conv_strategy(".md", "html") == "pandoc"


def test_txt_to_html_uses_pandoc():
    assert _doc_conv_strategy(".txt", "html") == "pandoc"


# ---------------------------------------------------------------------------
# Excel files must NOT use pandoc (use libreoffice instead)
# ---------------------------------------------------------------------------

def test_xlsx_to_html_uses_libreoffice_not_pandoc():
    strategy = _doc_conv_strategy(".xlsx", "html")
    assert strategy != "pandoc"
    assert strategy == "libreoffice"


def test_xls_to_txt_uses_libreoffice_not_pandoc():
    strategy = _doc_conv_strategy(".xls", "txt")
    assert strategy != "pandoc"
    assert strategy == "libreoffice"


# ---------------------------------------------------------------------------
# Same-format passthrough
# ---------------------------------------------------------------------------

def test_pdf_to_pdf_is_passthrough():
    assert _doc_conv_strategy(".pdf", "pdf") == "passthrough"


def test_docx_to_docx_is_passthrough():
    assert _doc_conv_strategy(".docx", "docx") == "passthrough"


def test_jpg_to_jpg_is_passthrough():
    assert _doc_conv_strategy(".jpg", "jpg") == "passthrough"


# ---------------------------------------------------------------------------
# Default Office conversions use libreoffice
# ---------------------------------------------------------------------------

def test_docx_to_pdf_uses_libreoffice():
    assert _doc_conv_strategy(".docx", "pdf") == "libreoffice"


def test_pptx_to_pdf_uses_libreoffice():
    assert _doc_conv_strategy(".pptx", "pdf") == "libreoffice"


def test_xlsx_to_pdf_uses_libreoffice():
    assert _doc_conv_strategy(".xlsx", "pdf") == "libreoffice"


def test_odt_to_docx_uses_libreoffice():
    assert _doc_conv_strategy(".odt", "docx") == "libreoffice"
