"""Tests for YouTube helper and download validation functions in api/app.py.

These tests verify that:
  - _is_auth_error() correctly identifies all known bot-detection / auth
    error patterns emitted by yt-dlp.
  - _is_auth_error() does NOT fire on benign error strings.
  - check_youtube_connectivity() returns the expected dict shape and
    correctly categorises its result (mocked – no real network call).
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import pytest

from api.app import _is_auth_error, _AUTH_PATTERNS, check_youtube_connectivity, start_download


# ---------------------------------------------------------------------------
# _is_auth_error: known bot-detection / auth patterns
# ---------------------------------------------------------------------------

class TestIsAuthError:
    """_is_auth_error must return True for all known auth / bot patterns."""

    @pytest.mark.parametrize("pattern", list(_AUTH_PATTERNS))
    def test_each_auth_pattern_is_detected(self, pattern):
        assert _is_auth_error(pattern), (
            f"_is_auth_error should return True for pattern: {pattern!r}"
        )

    @pytest.mark.parametrize("pattern", list(_AUTH_PATTERNS))
    def test_pattern_detection_is_case_insensitive(self, pattern):
        assert _is_auth_error(pattern.upper()), (
            f"_is_auth_error should be case-insensitive for: {pattern!r}"
        )

    def test_sign_in_confirm_bot(self):
        assert _is_auth_error("Sign in to confirm you're not a bot")

    def test_login_required_message(self):
        assert _is_auth_error("ERROR: login required")

    def test_use_cookies_hint(self):
        assert _is_auth_error("Please use --cookies to authenticate")

    def test_invalid_cookie(self):
        assert _is_auth_error("Cookie is invalid, please refresh")

    def test_expired_cookie(self):
        assert _is_auth_error("cookie expired")

    def test_missing_cookie(self):
        assert _is_auth_error("cookie missing for this request")

    def test_rejected_cookie(self):
        assert _is_auth_error("cookie was rejected by YouTube")


class TestIsAuthErrorNegative:
    """_is_auth_error must return False for benign / unrelated errors."""

    def test_generic_network_error(self):
        assert not _is_auth_error("Connection timed out")

    def test_format_unavailable(self):
        assert not _is_auth_error("Requested format is not available")

    def test_empty_string(self):
        assert not _is_auth_error("")

    def test_video_unavailable(self):
        assert not _is_auth_error("This video is unavailable")

    def test_unrelated_cookie_message(self):
        # "cookie" alone, without a failure keyword, must NOT trigger the flag
        assert not _is_auth_error("Sending cookie header to server")


# ---------------------------------------------------------------------------
# check_youtube_connectivity: mocked network calls
# ---------------------------------------------------------------------------

class TestCheckYoutubeConnectivity:
    """check_youtube_connectivity must return the correct dict shape and
    classify the outcome without making real network requests."""

    def test_returns_reachable_on_success(self):
        mock_info = {"title": "Big Buck Bunny", "id": "aqz-KE-bpKQ"}
        mock_ydl = MagicMock()
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)
        mock_ydl.extract_info = MagicMock(return_value=mock_info)

        with patch("api.app.yt_dlp.YoutubeDL", return_value=mock_ydl):
            result = check_youtube_connectivity()

        assert result["reachable"] is True
        assert result["bot_detected"] is False
        assert "message" in result

    def test_detects_bot_detection_error(self):
        mock_ydl = MagicMock()
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)
        mock_ydl.extract_info = MagicMock(
            side_effect=Exception("Sign in to confirm you're not a bot")
        )

        with patch("api.app.yt_dlp.YoutubeDL", return_value=mock_ydl):
            result = check_youtube_connectivity()

        assert result["reachable"] is False
        assert result["bot_detected"] is True
        assert "message" in result

    def test_other_error_is_not_bot_detected(self):
        mock_ydl = MagicMock()
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)
        mock_ydl.extract_info = MagicMock(
            side_effect=Exception("Connection timed out")
        )

        with patch("api.app.yt_dlp.YoutubeDL", return_value=mock_ydl):
            result = check_youtube_connectivity()

        assert result["reachable"] is False
        assert result["bot_detected"] is False
        assert "message" in result

    def test_result_always_has_required_keys(self):
        mock_ydl = MagicMock()
        mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
        mock_ydl.__exit__ = MagicMock(return_value=False)
        mock_ydl.extract_info = MagicMock(return_value={"title": "Test"})

        with patch("api.app.yt_dlp.YoutubeDL", return_value=mock_ydl):
            result = check_youtube_connectivity()

        assert "reachable" in result
        assert "bot_detected" in result
        assert "message" in result
        assert isinstance(result["reachable"], bool)
        assert isinstance(result["bot_detected"], bool)
        assert isinstance(result["message"], str)


class TestStartDownloadValidation:
    """start_download should validate input instead of raising a 500."""

    def test_missing_url_returns_400(self):
        request = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))

        response = asyncio.run(
            start_download(
                request=request,
                url=None,
                format="best",
                ext="mp4",
                session_id=None,
            )
        )

        assert response.status_code == 400
        assert response.body == b'{"error":"URL is required"}'
