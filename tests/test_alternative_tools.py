"""Tests for DRM detection, alternative tool fallback, and player client configuration.

These tests verify that:
  - _is_drm_error() correctly identifies all known DRM error patterns.
  - _is_drm_error() does NOT fire on unrelated error strings.
  - _friendly_cookie_error() maps DRM errors to _GENTLE_FAILURE_MESSAGE.
  - _try_alternative_tools_download() succeeds when an alternative tool works.
  - _try_alternative_tools_download() skips tools not present in PATH.
  - _try_alternative_tools_download() returns None when all tools fail.
  - _try_alternative_tools_download() respects a cancellation flag.
  - _get_yt_extractor_args() includes the mweb player client.
  - _get_cookieless_extractor_args() includes the mweb player client.
"""

import os
import tempfile
from unittest.mock import patch, MagicMock

import pytest

from api.app import (
    _is_drm_error,
    _DRM_PATTERNS,
    _friendly_cookie_error,
    _GENTLE_FAILURE_MESSAGE,
    _try_alternative_tools_download,
    _ALT_MEDIA_EXTS,
    _ALTERNATIVE_TOOL_COMMANDS,
    _find_media_file,
    _get_yt_extractor_args,
    _get_cookieless_extractor_args,
    downloads,
    downloads_lock,
)


# ---------------------------------------------------------------------------
# _is_drm_error: known DRM patterns
# ---------------------------------------------------------------------------

class TestIsDrmError:
    """_is_drm_error must return True for all known DRM error patterns."""

    @pytest.mark.parametrize("pattern", list(_DRM_PATTERNS))
    def test_each_drm_pattern_is_detected(self, pattern):
        assert _is_drm_error(pattern), (
            f"_is_drm_error should return True for pattern: {pattern!r}"
        )

    @pytest.mark.parametrize("pattern", list(_DRM_PATTERNS))
    def test_pattern_detection_is_case_insensitive(self, pattern):
        assert _is_drm_error(pattern.upper()), (
            f"_is_drm_error should be case-insensitive for: {pattern!r}"
        )

    def test_youtube_drm_error_message(self):
        assert _is_drm_error("ERROR: [youtube] JCYmlCVxtBw: This video is DRM protected.")

    def test_drm_protected_generic(self):
        assert _is_drm_error("This content is DRM protected and cannot be downloaded")

    def test_widevine_error(self):
        assert _is_drm_error("Widevine DRM is required for this content")

    def test_playready_error(self):
        assert _is_drm_error("PlayReady license required")

    def test_fairplay_error(self):
        assert _is_drm_error("FairPlay protection detected")


class TestIsDrmErrorNegative:
    """_is_drm_error must return False for unrelated errors."""

    def test_generic_network_error(self):
        assert not _is_drm_error("Connection timed out")

    def test_auth_error(self):
        assert not _is_drm_error("Sign in to confirm you're not a bot")

    def test_format_unavailable(self):
        assert not _is_drm_error("Requested format is not available")

    def test_empty_string(self):
        assert not _is_drm_error("")

    def test_video_unavailable(self):
        assert not _is_drm_error("This video is unavailable")

    def test_private_video(self):
        assert not _is_drm_error("This video is private and cannot be downloaded")


# ---------------------------------------------------------------------------
# _friendly_cookie_error: DRM errors map to _GENTLE_FAILURE_MESSAGE
# ---------------------------------------------------------------------------

class TestFriendlyCookieErrorDrm:
    """DRM errors must be translated to the gentle failure message."""

    def test_drm_error_mapped_to_gentle_message(self):
        msg = _friendly_cookie_error("This video is DRM protected.")
        assert msg == _GENTLE_FAILURE_MESSAGE

    def test_youtube_drm_error_mapped(self):
        msg = _friendly_cookie_error(
            "ERROR: [youtube] abc123: This video is DRM protected."
        )
        assert msg == _GENTLE_FAILURE_MESSAGE

    def test_non_drm_error_unchanged(self):
        original = "Some other unexpected error occurred"
        assert _friendly_cookie_error(original) == original


# ---------------------------------------------------------------------------
# _get_yt_extractor_args / _get_cookieless_extractor_args: mweb included
# ---------------------------------------------------------------------------

class TestExtractorArgs:
    """mweb must be present in both primary and cookieless extractor args."""

    def test_primary_args_includes_mweb(self):
        args = _get_yt_extractor_args()
        clients = args["youtube"]["player_client"]
        assert "mweb" in clients, "mweb must be in primary player_client list"

    def test_primary_args_keeps_default(self):
        args = _get_yt_extractor_args()
        clients = args["youtube"]["player_client"]
        assert "default" in clients, "'default' must remain in primary player_client list"

    def test_cookieless_args_includes_mweb(self):
        args = _get_cookieless_extractor_args()
        clients = args["youtube"]["player_client"]
        assert "mweb" in clients, "mweb must be in cookieless player_client list"

    def test_cookieless_args_no_default(self):
        args = _get_cookieless_extractor_args()
        clients = args["youtube"]["player_client"]
        assert "default" not in clients, "'default' must NOT be in cookieless player_client list"


# ---------------------------------------------------------------------------
# _find_media_file: finds media in a directory
# ---------------------------------------------------------------------------

class TestFindMediaFile:
    def test_finds_mp4_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "video.mp4")
            open(path, "w").close()
            assert _find_media_file(tmpdir) == path

    def test_returns_none_when_no_media(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "readme.txt")
            open(path, "w").close()
            assert _find_media_file(tmpdir) is None

    def test_returns_none_for_empty_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            assert _find_media_file(tmpdir) is None

    def test_returns_none_for_missing_directory(self):
        assert _find_media_file("/nonexistent/path") is None


# ---------------------------------------------------------------------------
# _try_alternative_tools_download: behaviour when tools succeed/fail/absent
# ---------------------------------------------------------------------------

class TestTryAlternativeToolsDownload:
    """Tests for the alternative tool fallback function."""

    def _make_proc(self, returncode=0, stderr=b""):
        proc = MagicMock()
        proc.returncode = returncode
        # poll() returns None once (running), then returncode (finished)
        proc.poll.side_effect = [None, returncode]
        proc.stderr.read.return_value = stderr
        proc.terminate = MagicMock()
        return proc

    def test_succeeds_when_tool_produces_file(self):
        """Returns the media file path when an alternative tool succeeds."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Pre-create the media file that the tool "would" produce
            media_path = os.path.join(tmpdir, "video.mp4")
            open(media_path, "w").close()

            proc = self._make_proc(returncode=0)
            with (
                patch("shutil.which", return_value="/usr/bin/gallery-dl"),
                patch("subprocess.Popen", return_value=proc),
            ):
                result = _try_alternative_tools_download(
                    "https://example.com/video", tmpdir
                )
            assert result == media_path

    def test_returns_none_when_no_tools_in_path(self):
        """Returns None when no alternative tools are installed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("shutil.which", return_value=None):
                result = _try_alternative_tools_download(
                    "https://example.com/video", tmpdir
                )
            assert result is None

    def test_returns_none_when_all_tools_fail(self):
        """Returns None when all tools return a non-zero exit code."""
        with tempfile.TemporaryDirectory() as tmpdir:
            proc = self._make_proc(returncode=1, stderr=b"error: not supported")
            with (
                patch("shutil.which", return_value="/usr/bin/gallery-dl"),
                patch("subprocess.Popen", return_value=proc),
            ):
                result = _try_alternative_tools_download(
                    "https://example.com/video", tmpdir
                )
            assert result is None

    def test_skips_missing_tools_tries_next(self):
        """Skips tools not in PATH and tries the next available one."""
        with tempfile.TemporaryDirectory() as tmpdir:
            media_path = os.path.join(tmpdir, "video.mp4")
            open(media_path, "w").close()

            proc = self._make_proc(returncode=0)

            def which_side_effect(name):
                # gallery-dl absent, you-get present
                if name == "gallery-dl":
                    return None
                return f"/usr/bin/{name}"

            with (
                patch("shutil.which", side_effect=which_side_effect),
                patch("subprocess.Popen", return_value=proc),
            ):
                result = _try_alternative_tools_download(
                    "https://example.com/video", tmpdir
                )
            assert result == media_path

    def test_stops_after_max_three_tools(self):
        """Never tries more than 3 tools."""
        with tempfile.TemporaryDirectory() as tmpdir:
            proc = self._make_proc(returncode=1)
            popen_calls = []

            def fake_popen(*args, **kwargs):
                popen_calls.append(args)
                return proc

            with (
                patch("shutil.which", return_value="/usr/bin/tool"),
                patch("subprocess.Popen", side_effect=fake_popen),
            ):
                _try_alternative_tools_download(
                    "https://example.com/video", tmpdir
                )
            # At most 3 Popen calls (matching len(_ALTERNATIVE_TOOL_COMMANDS))
            assert len(popen_calls) <= 3

    def test_cancellation_stops_tool(self):
        """When download is cancelled, the running tool is terminated and None is returned."""
        download_id = "test-cancel-999"
        with tempfile.TemporaryDirectory() as tmpdir:
            # Simulate a long-running process
            proc = MagicMock()
            proc.returncode = None
            # poll() keeps returning None (running) so the loop checks cancellation
            proc.poll.return_value = None
            proc.terminate = MagicMock()

            # Register a cancelled download
            with downloads_lock:
                downloads[download_id] = {"status": "cancelled"}

            try:
                with (
                    patch("shutil.which", return_value="/usr/bin/gallery-dl"),
                    patch("subprocess.Popen", return_value=proc),
                ):
                    result = _try_alternative_tools_download(
                        "https://example.com/video", tmpdir, download_id=download_id
                    )
                assert result is None
                proc.terminate.assert_called_once()
            finally:
                with downloads_lock:
                    downloads.pop(download_id, None)
