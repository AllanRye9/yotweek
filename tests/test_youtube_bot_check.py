"""Tests for YouTube helper and download validation functions in api/app.py.

These tests verify that:
  - _is_auth_error() correctly identifies all known bot-detection / auth
    error patterns emitted by yt-dlp.
  - _is_auth_error() does NOT fire on benign error strings.
  - check_youtube_connectivity() returns the expected dict shape and
    correctly categorises its result (mocked – no real network call).
  - _get_human_like_headers() returns a dict that includes human-browser
    fingerprint headers required to avoid YouTube bot-detection.
  - _random_sleep_interval() returns a float in the expected range.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import pytest

from api.app import (
    _is_auth_error,
    _AUTH_PATTERNS,
    check_youtube_connectivity,
    start_download,
    _get_human_like_headers,
    _get_headers_for_url,
    _random_sleep_interval,
    _CHROME_UA,
    _is_youtube_url,
    _get_yt_extractor_args,
    _get_cookieless_extractor_args,
)


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

    def test_cannot_be_downloaded_right_now(self):
        """YouTube bot-detection throttle error must be treated as an auth/bot error.

        YouTube returns this directly when it blocks automated requests even
        without a sign-in prompt.  See README Troubleshooting section:
        "This video cannot be downloaded right now".
        """
        assert _is_auth_error(
            "This video cannot be downloaded right now. "
            "Please try again in a few minutes, or try a different video."
        )

    def test_try_again_in_a_few_minutes_alone(self):
        """Partial YouTube throttle phrase is also detected."""
        assert _is_auth_error("Please try again in a few minutes")


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


# ---------------------------------------------------------------------------
# _get_human_like_headers: browser fingerprint headers
# ---------------------------------------------------------------------------

class TestGetHumanLikeHeaders:
    """_get_human_like_headers must return a complete browser fingerprint."""

    def test_returns_dict(self):
        headers = _get_human_like_headers()
        assert isinstance(headers, dict)

    def test_user_agent_matches_chrome_ua(self):
        headers = _get_human_like_headers()
        assert headers.get("User-Agent") == _CHROME_UA

    def test_accept_language_present(self):
        headers = _get_human_like_headers()
        assert "Accept-Language" in headers
        assert headers["Accept-Language"]

    def test_accept_present(self):
        headers = _get_human_like_headers()
        assert "Accept" in headers

    def test_dnt_present(self):
        headers = _get_human_like_headers()
        assert "DNT" in headers

    def test_sec_ch_ua_present(self):
        headers = _get_human_like_headers()
        assert "sec-ch-ua" in headers

    def test_sec_fetch_site_present(self):
        headers = _get_human_like_headers()
        assert "Sec-Fetch-Site" in headers

    def test_different_calls_are_consistent(self):
        """Headers should be deterministic (no random values)."""
        assert _get_human_like_headers() == _get_human_like_headers()


# ---------------------------------------------------------------------------
# _random_sleep_interval: jitter helper
# ---------------------------------------------------------------------------

class TestRandomSleepInterval:
    """_random_sleep_interval must return a float within the documented range."""

    def test_returns_float(self):
        assert isinstance(_random_sleep_interval(), float)

    def test_within_range(self):
        for _ in range(50):
            val = _random_sleep_interval()
            assert 3.0 <= val <= 8.0, f"sleep interval {val} is out of expected [3, 8] range"


# ---------------------------------------------------------------------------
# New _AUTH_PATTERNS: throttle / rate-limit variants
# ---------------------------------------------------------------------------

class TestNewAuthPatterns:
    """New patterns added to _AUTH_PATTERNS must be detected by _is_auth_error."""

    def test_cannot_be_downloaded_right_now_pattern(self):
        assert _is_auth_error("cannot be downloaded right now")

    def test_too_many_requests_pattern(self):
        assert _is_auth_error("HTTP Error 429: Too Many Requests")

    def test_http_error_429_lowercase(self):
        assert _is_auth_error("http error 429")

    def test_precondition_check_failed(self):
        assert _is_auth_error("Precondition check failed")

    def test_innertube_context_keyerror(self):
        """INNERTUBE_CONTEXT KeyError must be treated as a bot-detection error.

        yt-dlp raises KeyError('INNERTUBE_CONTEXT') when YouTube's API response
        is missing the InnerTube context key, which occurs during bot-detection
        blocks or when a player client receives an unexpected response format.
        """
        assert _is_auth_error(
            "An extractor error has occurred. (caused by KeyError('INNERTUBE_CONTEXT'))"
        )


# ---------------------------------------------------------------------------
# _is_youtube_url: URL classifier used to gate YouTube-specific headers/retry
# ---------------------------------------------------------------------------

class TestIsYoutubeUrl:
    """_is_youtube_url must correctly distinguish YouTube from other platforms."""

    @pytest.mark.parametrize("url", [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "http://www.youtube.com/watch?v=abc123",
        "https://www.youtube.com/shorts/abc123",
    ])
    def test_youtube_urls_return_true(self, url):
        assert _is_youtube_url(url), f"Expected True for YouTube URL: {url}"

    @pytest.mark.parametrize("url", [
        "https://www.tiktok.com/@user/video/7612635779323399441",
        "https://vm.tiktok.com/ZMLxyz/",
        "https://www.instagram.com/reel/abc123/",
        "https://twitter.com/user/status/123456789",
        "https://x.com/user/status/123456789",
        "https://vimeo.com/123456789",
        "https://www.reddit.com/r/videos/comments/abc123/",
        "https://twitch.tv/videos/123456789",
        "https://www.facebook.com/video/123456789",
        "https://dailymotion.com/video/abc123",
    ])
    def test_non_youtube_urls_return_false(self, url):
        assert not _is_youtube_url(url), f"Expected False for non-YouTube URL: {url}"

    def test_empty_string_returns_false(self):
        assert not _is_youtube_url("")

    def test_youtube_in_path_does_not_match(self):
        """A URL that merely mentions 'youtube' in a path should not match."""
        assert not _is_youtube_url("https://example.com/share?ref=youtube.com")


# ---------------------------------------------------------------------------
# _get_headers_for_url: URL-conditional header selection
# ---------------------------------------------------------------------------

class TestGetHeadersForUrl:
    """_get_headers_for_url must return full browser headers for YouTube and
    User-Agent-only headers for all other platforms."""

    def test_youtube_returns_full_headers(self):
        headers = _get_headers_for_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert headers == _get_human_like_headers()

    def test_tiktok_returns_only_user_agent(self):
        headers = _get_headers_for_url("https://www.tiktok.com/@user/video/123456789")
        assert headers == {"User-Agent": _CHROME_UA}
        assert "Sec-Fetch-Mode" not in headers
        assert "Sec-Fetch-Dest" not in headers

    def test_instagram_returns_only_user_agent(self):
        headers = _get_headers_for_url("https://www.instagram.com/reel/abc123/")
        assert headers == {"User-Agent": _CHROME_UA}

    def test_youtu_be_returns_full_headers(self):
        headers = _get_headers_for_url("https://youtu.be/dQw4w9WgXcQ")
        assert headers == _get_human_like_headers()


# ---------------------------------------------------------------------------
# _get_yt_extractor_args: primary player client configuration
# ---------------------------------------------------------------------------

class TestGetYtExtractorArgs:
    """_get_yt_extractor_args must return the correct player client list."""

    def test_returns_youtube_key(self):
        args = _get_yt_extractor_args()
        assert "youtube" in args

    def test_player_client_key_present(self):
        args = _get_yt_extractor_args()
        assert "player_client" in args["youtube"]

    def test_default_client_present(self):
        """'default' must not be removed — it enables yt-dlp session-aware selection."""
        clients = _get_yt_extractor_args()["youtube"]["player_client"]
        assert "default" in clients, "'default' must remain in player_client list"

    def test_web_embedded_client_present(self):
        """'web_embedded' is a POT-free fallback required since yt-dlp 2026.3.13."""
        clients = _get_yt_extractor_args()["youtube"]["player_client"]
        assert "web_embedded" in clients

    def test_tv_client_present(self):
        """'tv' is a POT-free fallback with the highest priority (40)."""
        clients = _get_yt_extractor_args()["youtube"]["player_client"]
        assert "tv" in clients

    def test_mweb_client_present(self):
        """'mweb' (Mobile Web) is a POT-free fallback with distinct bot-detection thresholds.

        YouTube's mobile web endpoint uses different heuristics than desktop clients,
        so including 'mweb' provides an additional bypass option when 'web_embedded'
        and 'tv' are rate-limited or blocked.
        """
        clients = _get_yt_extractor_args()["youtube"]["player_client"]
        assert "mweb" in clients, (
            "'mweb' must be in player_client list to provide mobile-web fallback "
            "against YouTube bot-detection"
        )

    def test_returns_list_not_tuple(self):
        clients = _get_yt_extractor_args()["youtube"]["player_client"]
        assert isinstance(clients, list)


# ---------------------------------------------------------------------------
# _get_cookieless_extractor_args: unauthenticated player client configuration
# ---------------------------------------------------------------------------

class TestGetCookielessExtractorArgs:
    """_get_cookieless_extractor_args must return only POT-free clients."""

    def test_returns_youtube_key(self):
        args = _get_cookieless_extractor_args()
        assert "youtube" in args

    def test_player_client_key_present(self):
        args = _get_cookieless_extractor_args()
        assert "player_client" in args["youtube"]

    def test_web_embedded_client_present(self):
        clients = _get_cookieless_extractor_args()["youtube"]["player_client"]
        assert "web_embedded" in clients

    def test_tv_client_present(self):
        clients = _get_cookieless_extractor_args()["youtube"]["player_client"]
        assert "tv" in clients

    def test_mweb_client_present(self):
        """'mweb' must be in cookieless args as a mobile-web fallback.

        When 'web_embedded' and 'tv' are both blocked by YouTube's bot-detection,
        'mweb' provides an additional POT-free option that uses the mobile YouTube
        endpoint (m.youtube.com) with different rate-limiting thresholds.
        """
        clients = _get_cookieless_extractor_args()["youtube"]["player_client"]
        assert "mweb" in clients, (
            "'mweb' must be in cookieless player_client list for mobile-web fallback"
        )

    def test_default_not_present(self):
        """Cookieless args must not include 'default' (which expands to auth-aware defaults)."""
        clients = _get_cookieless_extractor_args()["youtube"]["player_client"]
        assert "default" not in clients, (
            "'default' should not be in cookieless extractor args — "
            "it expands to clients that may require auth"
        )

    def test_returns_list_not_tuple(self):
        clients = _get_cookieless_extractor_args()["youtube"]["player_client"]
        assert isinstance(clients, list)
