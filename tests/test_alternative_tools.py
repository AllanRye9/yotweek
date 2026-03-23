"""Tests for the alternative-downloader cluster added to api/app.py.

These tests verify that:
  - _find_media_file() returns the first media file found recursively.
  - _find_media_file() returns None when no media file is present.
  - _try_alternative_tools_download() skips tools that are not on PATH.
  - _try_alternative_tools_download() returns None when all tools fail.
  - _try_alternative_tools_download() returns a file path when a tool succeeds.
  - _ALTERNATIVE_TOOL_COMMANDS contains the expected tool labels.
  - _ALT_MEDIA_EXTS covers common video and audio extensions.
"""

import os
import shutil
import tempfile
from unittest.mock import patch, MagicMock
import subprocess

import pytest

from api.app import (
    _find_media_file,
    _try_alternative_tools_download,
    _ALTERNATIVE_TOOL_COMMANDS,
    _ALT_MEDIA_EXTS,
    _cleanup_partial_files,
    _PARTIAL_FILE_EXTS,
)


# ---------------------------------------------------------------------------
# _ALT_MEDIA_EXTS: extension registry
# ---------------------------------------------------------------------------

class TestAltMediaExts:
    """_ALT_MEDIA_EXTS must include common video and audio formats."""

    @pytest.mark.parametrize("ext", [
        ".mp4", ".mkv", ".webm", ".avi", ".mov",
        ".mp3", ".m4a", ".ogg", ".opus",
    ])
    def test_common_extensions_present(self, ext):
        assert ext in _ALT_MEDIA_EXTS, f"{ext} should be in _ALT_MEDIA_EXTS"

    def test_extensions_are_lowercase(self):
        for ext in _ALT_MEDIA_EXTS:
            assert ext == ext.lower(), f"Extension {ext!r} should be lowercase"

    def test_extensions_start_with_dot(self):
        for ext in _ALT_MEDIA_EXTS:
            assert ext.startswith("."), f"Extension {ext!r} should start with '.'"


# ---------------------------------------------------------------------------
# _ALTERNATIVE_TOOL_COMMANDS: expected tool registrations
# ---------------------------------------------------------------------------

class TestAlternativeToolCommands:
    """_ALTERNATIVE_TOOL_COMMANDS must register at least gallery-dl."""

    def test_gallery_dl_registered(self):
        labels = [label for label, _ in _ALTERNATIVE_TOOL_COMMANDS]
        assert "gallery-dl" in labels

    def test_you_get_registered(self):
        labels = [label for label, _ in _ALTERNATIVE_TOOL_COMMANDS]
        assert "you-get" in labels

    def test_streamlink_registered(self):
        labels = [label for label, _ in _ALTERNATIVE_TOOL_COMMANDS]
        assert "streamlink" in labels

    def test_each_entry_has_url_placeholder(self):
        for label, cmd in _ALTERNATIVE_TOOL_COMMANDS:
            flat = " ".join(cmd)
            assert "{url}" in flat, (
                f"Command for '{label}' must contain {{url}} placeholder"
            )

    def test_each_entry_has_output_dir_placeholder(self):
        for label, cmd in _ALTERNATIVE_TOOL_COMMANDS:
            flat = " ".join(cmd)
            assert "{output_dir}" in flat, (
                f"Command for '{label}' must contain {{output_dir}} placeholder"
            )


# ---------------------------------------------------------------------------
# _find_media_file: recursive media file discovery
# ---------------------------------------------------------------------------

class TestFindMediaFile:
    """_find_media_file must locate media files and return None otherwise."""

    def test_returns_none_on_empty_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            assert _find_media_file(tmpdir) is None

    def test_returns_none_for_non_media_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            open(os.path.join(tmpdir, "README.txt"), "w").close()
            open(os.path.join(tmpdir, "image.jpg"), "w").close()
            assert _find_media_file(tmpdir) is None

    def test_finds_mp4_in_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            fpath = os.path.join(tmpdir, "video.mp4")
            open(fpath, "w").close()
            result = _find_media_file(tmpdir)
            assert result == fpath

    def test_finds_mp3_in_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            fpath = os.path.join(tmpdir, "audio.mp3")
            open(fpath, "w").close()
            result = _find_media_file(tmpdir)
            assert result == fpath

    def test_finds_mkv_in_subdirectory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "sub")
            os.makedirs(subdir)
            fpath = os.path.join(subdir, "video.mkv")
            open(fpath, "w").close()
            result = _find_media_file(tmpdir)
            assert result == fpath

    def test_extension_check_is_case_insensitive(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            fpath = os.path.join(tmpdir, "video.MP4")
            open(fpath, "w").close()
            result = _find_media_file(tmpdir)
            assert result == fpath

    def test_returns_first_file_found(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            f1 = os.path.join(tmpdir, "a.mp4")
            f2 = os.path.join(tmpdir, "b.mp4")
            open(f1, "w").close()
            open(f2, "w").close()
            result = _find_media_file(tmpdir)
            assert result in (f1, f2)


# ---------------------------------------------------------------------------
# _try_alternative_tools_download: integration (fully mocked)
# ---------------------------------------------------------------------------

class TestTryAlternativeToolsDownload:
    """_try_alternative_tools_download must skip absent tools and return the
    path of the first successfully downloaded file."""

    def test_returns_none_when_no_tools_on_path(self):
        """All tools absent → return None immediately."""
        with patch("api.app.shutil.which", return_value=None):
            result = _try_alternative_tools_download(
                "https://example.com/video", "/tmp"
            )
        assert result is None

    def test_skips_tool_when_not_on_path(self):
        """which() returning None for a tool must cause it to be skipped."""
        call_log: list[str] = []

        def fake_which(exe: str):
            call_log.append(exe)
            return None  # nothing is installed

        with patch("api.app.shutil.which", side_effect=fake_which), \
             patch("api.app.os.makedirs"), \
             patch("api.app.shutil.rmtree"):
            _try_alternative_tools_download("https://example.com/video", "/tmp")

        # shutil.which should have been called once for each registered tool
        for label, cmd in _ALTERNATIVE_TOOL_COMMANDS:
            assert cmd[0] in call_log, (
                f"shutil.which should have been called for '{cmd[0]}'"
            )

    def test_returns_none_when_all_tools_fail(self):
        """All tools installed but all return non-zero exit code → None."""
        failed_proc = MagicMock()
        failed_proc.returncode = 1
        failed_proc.communicate.return_value = ("", "error")

        with patch("api.app.shutil.which", return_value="/usr/bin/fake"), \
             tempfile.TemporaryDirectory() as tmpdir, \
             patch("api.app.subprocess.Popen", return_value=failed_proc):
            result = _try_alternative_tools_download(
                "https://example.com/video", tmpdir
            )
        assert result is None

    def test_returns_file_path_on_first_success(self):
        """First tool that exits 0 and produces a media file wins."""
        with tempfile.TemporaryDirectory() as output_dir:
            # Capture the alt_tmp path so we can plant a file there
            captured_alt_tmp: list[str] = []
            real_makedirs = os.makedirs

            def fake_makedirs(path, **kwargs):
                if os.path.basename(path).startswith("_alt_"):
                    captured_alt_tmp.append(path)
                real_makedirs(path, **kwargs)

            def fake_popen(cmd, **kwargs):
                # Plant a media file in the alt_tmp directory
                if captured_alt_tmp:
                    media = os.path.join(captured_alt_tmp[-1], "video.mp4")
                    open(media, "w").close()
                proc = MagicMock()
                proc.returncode = 0
                proc.communicate.return_value = ("", "")
                return proc

            with patch("api.app.shutil.which", return_value="/usr/bin/fake"), \
                 patch("api.app.os.makedirs", side_effect=fake_makedirs), \
                 patch("api.app.subprocess.Popen", side_effect=fake_popen):
                result = _try_alternative_tools_download(
                    "https://example.com/video", output_dir
                )

        assert result is not None
        assert result.endswith(".mp4")

    def test_tries_next_tool_when_first_produces_no_file(self):
        """A tool that exits 0 but creates no media file must not block the next."""
        call_count = {"n": 0}

        with tempfile.TemporaryDirectory() as output_dir:
            captured_alt_tmp: list[str] = []
            real_makedirs = os.makedirs

            def fake_makedirs(path, **kwargs):
                if os.path.basename(path).startswith("_alt_"):
                    captured_alt_tmp.append(path)
                real_makedirs(path, **kwargs)

            def fake_popen(cmd, **kwargs):
                call_count["n"] += 1
                # Only the second call plants a file
                if call_count["n"] == 2 and captured_alt_tmp:
                    media = os.path.join(captured_alt_tmp[-1], "audio.mp3")
                    open(media, "w").close()
                proc = MagicMock()
                proc.returncode = 0
                proc.communicate.return_value = ("", "")
                return proc

            with patch("api.app.shutil.which", return_value="/usr/bin/fake"), \
                 patch("api.app.os.makedirs", side_effect=fake_makedirs), \
                 patch("api.app.subprocess.Popen", side_effect=fake_popen):
                result = _try_alternative_tools_download(
                    "https://example.com/video", output_dir
                )

        assert result is not None
        assert result.endswith(".mp3")
        assert call_count["n"] == 2

    def test_handles_timeout_gracefully(self):
        """subprocess.TimeoutExpired must be caught; next tool is tried."""
        call_count = {"n": 0}

        with tempfile.TemporaryDirectory() as output_dir:
            captured_alt_tmp: list[str] = []
            real_makedirs = os.makedirs

            def fake_makedirs(path, **kwargs):
                if os.path.basename(path).startswith("_alt_"):
                    captured_alt_tmp.append(path)
                real_makedirs(path, **kwargs)

            def fake_popen(cmd, **kwargs):
                call_count["n"] += 1
                proc = MagicMock()
                if call_count["n"] == 1:
                    proc.communicate.side_effect = subprocess.TimeoutExpired(cmd, 300)
                    proc.kill.return_value = None
                else:
                    # Second call succeeds with a media file
                    if captured_alt_tmp:
                        media = os.path.join(captured_alt_tmp[-1], "video.webm")
                        open(media, "w").close()
                    proc.returncode = 0
                    proc.communicate.return_value = ("", "")
                return proc

            with patch("api.app.shutil.which", return_value="/usr/bin/fake"), \
                 patch("api.app.os.makedirs", side_effect=fake_makedirs), \
                 patch("api.app.subprocess.Popen", side_effect=fake_popen):
                result = _try_alternative_tools_download(
                    "https://example.com/video", output_dir
                )

        assert result is not None
        assert call_count["n"] == 2

    def test_handles_unexpected_exception_gracefully(self):
        """An unexpected exception from subprocess must not propagate."""
        with patch("api.app.shutil.which", return_value="/usr/bin/fake"), \
             tempfile.TemporaryDirectory() as tmpdir, \
             patch("api.app.subprocess.Popen", side_effect=OSError("no such file")):
            result = _try_alternative_tools_download(
                "https://example.com/video", tmpdir
            )
        assert result is None

    def test_respects_cancellation_between_tools(self):
        """When download_id is provided and download is cancelled, loop aborts."""
        with patch("api.app.shutil.which", return_value="/usr/bin/fake"), \
             tempfile.TemporaryDirectory() as tmpdir, \
             patch("api.app.downloads_lock"), \
             patch("api.app.downloads", {"test-id": {"status": "cancelled"}}):
            result = _try_alternative_tools_download(
                "https://example.com/video", tmpdir, download_id="test-id"
            )
        assert result is None


# ---------------------------------------------------------------------------
# _cleanup_partial_files: remove partial downloads on cancellation
# ---------------------------------------------------------------------------

class TestCleanupPartialFiles:
    """_cleanup_partial_files must remove .part and .ytdl files."""

    def test_removes_part_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            part = os.path.join(tmpdir, "video.mp4.part")
            open(part, "w").close()
            template = os.path.join(tmpdir, "video.%(ext)s")
            _cleanup_partial_files(template)
            assert not os.path.exists(part)

    def test_removes_ytdl_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ytdl = os.path.join(tmpdir, "video.mp4.ytdl")
            open(ytdl, "w").close()
            template = os.path.join(tmpdir, "video.%(ext)s")
            _cleanup_partial_files(template)
            assert not os.path.exists(ytdl)

    def test_leaves_completed_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            complete = os.path.join(tmpdir, "video.mp4")
            open(complete, "w").close()
            template = os.path.join(tmpdir, "video.%(ext)s")
            _cleanup_partial_files(template)
            assert os.path.exists(complete)

    def test_ignores_unrelated_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            other = os.path.join(tmpdir, "other.mp4.part")
            open(other, "w").close()
            template = os.path.join(tmpdir, "video.%(ext)s")
            _cleanup_partial_files(template)
            assert os.path.exists(other)

    def test_handles_empty_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            template = os.path.join(tmpdir, "video.%(ext)s")
            # Should not raise
            _cleanup_partial_files(template)

    def test_partial_ext_registry(self):
        assert ".part" in _PARTIAL_FILE_EXTS
        assert ".ytdl" in _PARTIAL_FILE_EXTS
