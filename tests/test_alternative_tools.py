"""Tests for DRM detection, alternative tool fallback, player client configuration,
and ssyoutube fallback.

These tests verify that:
  - _is_drm_error() correctly identifies all known DRM error patterns.
  - _is_drm_error() does NOT fire on unrelated error strings.
  - _is_http_forbidden_error() correctly identifies HTTP 403 Forbidden errors.
  - _is_http_forbidden_error() does NOT fire on unrelated error strings.
  - _friendly_cookie_error() maps DRM errors to _GENTLE_FAILURE_MESSAGE.
  - _friendly_cookie_error() maps HTTP 403 errors to a user-friendly message.
  - _try_alternative_tools_download() succeeds when an alternative tool works.
  - _try_alternative_tools_download() skips tools not present in PATH.
  - _try_alternative_tools_download() returns None when all tools fail.
  - _try_alternative_tools_download() respects a cancellation flag.
  - _get_yt_extractor_args() includes the mweb player client.
  - _get_cookieless_extractor_args() includes the mweb player client.
  - _is_youtube_url() correctly detects YouTube URLs.
  - _extract_youtube_video_id() extracts the 11-character video ID.
  - _try_ssyoutube_download() succeeds when the API returns a valid download URL.
  - _try_ssyoutube_download() returns None for non-YouTube URLs.
  - _try_ssyoutube_download() returns None when the API call fails.
  - _try_ssyoutube_download() respects a cancellation flag.
"""

import io
import json
import os
import tempfile
from unittest.mock import patch, MagicMock

import pytest

from api.app import (
    _is_drm_error,
    _DRM_PATTERNS,
    _is_http_forbidden_error,
    _HTTP_FORBIDDEN_PATTERNS,
    _friendly_cookie_error,
    _GENTLE_FAILURE_MESSAGE,
    _try_alternative_tools_download,
    _ALT_MEDIA_EXTS,
    _ALTERNATIVE_TOOL_COMMANDS,
    _find_media_file,
    _get_yt_extractor_args,
    _get_cookieless_extractor_args,
    _is_youtube_url,
    _extract_youtube_video_id,
    _try_ssyoutube_download,
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
# _is_http_forbidden_error: HTTP 403 Forbidden patterns
# ---------------------------------------------------------------------------

class TestIsHttpForbiddenError:
    """_is_http_forbidden_error must return True for all known 403 patterns."""

    @pytest.mark.parametrize("pattern", list(_HTTP_FORBIDDEN_PATTERNS))
    def test_each_forbidden_pattern_is_detected(self, pattern):
        assert _is_http_forbidden_error(pattern), (
            f"_is_http_forbidden_error should return True for pattern: {pattern!r}"
        )

    @pytest.mark.parametrize("pattern", list(_HTTP_FORBIDDEN_PATTERNS))
    def test_pattern_detection_is_case_insensitive(self, pattern):
        assert _is_http_forbidden_error(pattern.upper()), (
            f"_is_http_forbidden_error should be case-insensitive for: {pattern!r}"
        )

    def test_full_yt_dlp_403_message(self):
        assert _is_http_forbidden_error(
            "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        )

    def test_short_403_forbidden(self):
        assert _is_http_forbidden_error("HTTP Error 403: Forbidden")

    def test_unable_to_download_video_data(self):
        assert _is_http_forbidden_error("unable to download video data: some reason")


class TestIsHttpForbiddenErrorNegative:
    """_is_http_forbidden_error must return False for unrelated errors."""

    def test_generic_network_error(self):
        assert not _is_http_forbidden_error("Connection timed out")

    def test_auth_error(self):
        assert not _is_http_forbidden_error("Sign in to confirm you're not a bot")

    def test_drm_error(self):
        assert not _is_http_forbidden_error("This video is DRM protected")

    def test_404_error(self):
        assert not _is_http_forbidden_error("HTTP Error 404: Not Found")

    def test_empty_string(self):
        assert not _is_http_forbidden_error("")

    def test_format_unavailable(self):
        assert not _is_http_forbidden_error("Requested format is not available")


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


class TestFriendlyCookieErrorHttp403:
    """HTTP 403 Forbidden errors must be translated to a user-friendly message."""

    def test_403_error_returns_friendly_message_with_403(self):
        msg = _friendly_cookie_error(
            "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        )
        assert "403" in msg

    def test_403_error_returns_friendly_message_with_forbidden(self):
        msg = _friendly_cookie_error(
            "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        )
        assert "Forbidden" in msg

    def test_403_error_does_not_expose_raw_error(self):
        raw = "unable to download video data: HTTP Error 403: Forbidden"
        msg = _friendly_cookie_error(raw)
        # The friendly message should not just be the raw internal error string
        assert msg != raw

    def test_403_message_is_actionable(self):
        msg = _friendly_cookie_error("HTTP Error 403: Forbidden")
        # Must contain guidance to try again
        assert "try again" in msg.lower()


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


# ---------------------------------------------------------------------------
# _is_youtube_url: YouTube URL detection
# ---------------------------------------------------------------------------

class TestIsYoutubeUrl:
    """_is_youtube_url must return True only for YouTube URLs."""

    @pytest.mark.parametrize("url", [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ])
    def test_youtube_urls_detected(self, url):
        assert _is_youtube_url(url), f"Expected True for {url!r}"

    @pytest.mark.parametrize("url", [
        "https://vimeo.com/123456789",
        "https://example.com/video",
        "https://dailymotion.com/video/x1234",
        "https://twitter.com/user/status/123",
        "",
    ])
    def test_non_youtube_urls_not_detected(self, url):
        assert not _is_youtube_url(url), f"Expected False for {url!r}"


# ---------------------------------------------------------------------------
# _extract_youtube_video_id: video ID extraction
# ---------------------------------------------------------------------------

class TestExtractYoutubeVideoId:
    """_extract_youtube_video_id must return the 11-char video ID."""

    def test_standard_watch_url(self):
        vid = _extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert vid == "dQw4w9WgXcQ"

    def test_short_url(self):
        vid = _extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ")
        assert vid == "dQw4w9WgXcQ"

    def test_mobile_url(self):
        vid = _extract_youtube_video_id("https://m.youtube.com/watch?v=dQw4w9WgXcQ")
        assert vid == "dQw4w9WgXcQ"

    def test_shorts_url(self):
        vid = _extract_youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ")
        assert vid == "dQw4w9WgXcQ"

    def test_embed_url(self):
        vid = _extract_youtube_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ")
        assert vid == "dQw4w9WgXcQ"

    def test_non_youtube_url_returns_none(self):
        assert _extract_youtube_video_id("https://vimeo.com/12345") is None

    def test_empty_string_returns_none(self):
        assert _extract_youtube_video_id("") is None


# ---------------------------------------------------------------------------
# _try_ssyoutube_download: behaviour with mocked network calls
# ---------------------------------------------------------------------------

class TestTrySsyoutubeDownload:
    """Tests for the ssyoutube / savefrom.net fallback function."""

    _YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    _VIDEO_ID = "dQw4w9WgXcQ"

    def _make_api_response(self, qualities=None, no_audio=False):
        """Build a minimal savefrom.net API JSON response."""
        if qualities is None:
            qualities = {"720": [{"url": "https://cdn.example.com/720.mp4",
                                   "ext": "mp4", "no_audio": no_audio}]}
        return json.dumps({"id": self._VIDEO_ID, "title": "Test", "url": qualities})

    def _make_urlopen_side_effect(self, api_json: str, file_content: bytes = b"fake-video-data"):
        """Return a side_effect list for two consecutive urlopen calls (API + file)."""
        api_resp = MagicMock()
        api_resp.__enter__ = lambda s: s
        api_resp.__exit__ = MagicMock(return_value=False)
        api_resp.read.return_value = api_json.encode()

        file_resp = MagicMock()
        file_resp.__enter__ = lambda s: s
        file_resp.__exit__ = MagicMock(return_value=False)
        # Simulate streaming: first call returns content, second returns b"" (EOF)
        file_resp.read.side_effect = [file_content, b""]

        return [api_resp, file_resp]

    def test_returns_none_for_non_youtube_url(self):
        result = _try_ssyoutube_download("https://vimeo.com/12345", "/tmp")
        assert result is None

    def test_returns_none_for_empty_url(self):
        result = _try_ssyoutube_download("", "/tmp")
        assert result is None

    def test_succeeds_when_api_returns_valid_link(self):
        api_json = self._make_api_response()
        with tempfile.TemporaryDirectory() as tmpdir:
            side_effects = self._make_urlopen_side_effect(api_json)
            with patch("urllib.request.urlopen", side_effect=side_effects):
                result = _try_ssyoutube_download(self._YOUTUBE_URL, tmpdir)
            assert result is not None
            assert result.endswith(".mp4")
            assert os.path.isfile(result)
            assert os.path.getsize(result) > 0

    def test_returns_none_when_api_call_raises(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("urllib.request.urlopen", side_effect=OSError("network error")):
                result = _try_ssyoutube_download(self._YOUTUBE_URL, tmpdir)
            assert result is None

    def test_returns_none_when_api_returns_empty_url_map(self):
        api_json = json.dumps({"id": self._VIDEO_ID, "title": "Test", "url": {}})
        with tempfile.TemporaryDirectory() as tmpdir:
            api_resp = MagicMock()
            api_resp.__enter__ = lambda s: s
            api_resp.__exit__ = MagicMock(return_value=False)
            api_resp.read.return_value = api_json.encode()
            with patch("urllib.request.urlopen", return_value=api_resp):
                result = _try_ssyoutube_download(self._YOUTUBE_URL, tmpdir)
            assert result is None

    def test_returns_none_when_all_formats_are_audio_only(self):
        api_json = self._make_api_response(
            qualities={"720": [{"url": "https://cdn.example.com/720.mp4",
                                 "ext": "mp4", "no_audio": True}]}
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            api_resp = MagicMock()
            api_resp.__enter__ = lambda s: s
            api_resp.__exit__ = MagicMock(return_value=False)
            api_resp.read.return_value = api_json.encode()
            with patch("urllib.request.urlopen", return_value=api_resp):
                result = _try_ssyoutube_download(self._YOUTUBE_URL, tmpdir)
            assert result is None

    def test_respects_cancellation_before_download(self):
        """Returns None when the download is cancelled before the file fetch begins."""
        download_id = "ssyt-cancel-test-001"
        api_json = self._make_api_response()
        with tempfile.TemporaryDirectory() as tmpdir:
            with downloads_lock:
                downloads[download_id] = {"status": "cancelled"}
            try:
                api_resp = MagicMock()
                api_resp.__enter__ = lambda s: s
                api_resp.__exit__ = MagicMock(return_value=False)
                api_resp.read.return_value = api_json.encode()
                with patch("urllib.request.urlopen", return_value=api_resp):
                    result = _try_ssyoutube_download(
                        self._YOUTUBE_URL, tmpdir, download_id=download_id
                    )
                assert result is None
            finally:
                with downloads_lock:
                    downloads.pop(download_id, None)

    def test_prefers_highest_quality_format(self):
        """Selects the highest quality (720 before 480) download URL."""
        chosen_urls = []

        api_json = self._make_api_response(
            qualities={
                "480": [{"url": "https://cdn.example.com/480.mp4", "ext": "mp4", "no_audio": False}],
                "720": [{"url": "https://cdn.example.com/720.mp4", "ext": "mp4", "no_audio": False}],
            }
        )

        def fake_urlopen(req, *args, **kwargs):
            import urllib.parse as _urlparse
            raw_url = req.full_url if hasattr(req, "full_url") else str(req)
            chosen_urls.append(raw_url)
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            parsed = _urlparse.urlparse(raw_url)
            if parsed.netloc == "worker.sf-tools.com":
                resp.read.return_value = api_json.encode()
            else:
                resp.read.side_effect = [b"fake-video-data", b""]
            return resp

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                result = _try_ssyoutube_download(self._YOUTUBE_URL, tmpdir)

        assert result is not None
        # The second urlopen call (file download) must use the 720p URL
        assert any("720.mp4" in u for u in chosen_urls)
