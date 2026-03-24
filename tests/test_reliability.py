"""Tests for reliability & compatibility features added per the
Universal Media Downloader specification:

- _validate_url()         — URL validation and input sanitization
- _url_hash()             — deterministic URL hashing
- _get_cached_download()  — deduplication cache lookup
- _cache_completed_download() — deduplication cache population
- _with_exponential_backoff() — retry with exponential back-off
- _CircuitBreaker         — circuit-breaker pattern
- /health endpoint        — enhanced health check
"""

import asyncio
import time
import os
import tempfile
import threading
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

import pytest

from api.app import (
    _validate_url,
    _url_hash,
    _get_cached_download,
    _cache_completed_download,
    _download_url_cache,
    _with_exponential_backoff,
    _CircuitBreaker,
    _extractor_circuit_breaker,
    downloads,
    downloads_lock,
    DOWNLOAD_FOLDER,
    health,
)


# ---------------------------------------------------------------------------
# _validate_url
# ---------------------------------------------------------------------------

class TestValidateUrl:
    """_validate_url must return None for valid URLs and an error string for invalid ones."""

    def test_valid_http_url(self):
        assert _validate_url("http://example.com/video") is None

    def test_valid_https_url(self):
        assert _validate_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") is None

    def test_valid_tiktok_url(self):
        assert _validate_url("https://www.tiktok.com/@user/video/123456789") is None

    def test_empty_string_is_invalid(self):
        result = _validate_url("")
        assert result is not None

    def test_none_equivalent_whitespace(self):
        result = _validate_url("   ")
        assert result is not None

    def test_javascript_scheme_blocked(self):
        result = _validate_url("javascript:alert(1)")
        assert result is not None
        assert "allowed" in result.lower() or "invalid" in result.lower()

    def test_data_scheme_blocked(self):
        result = _validate_url("data:text/html,<script>alert(1)</script>")
        assert result is not None

    def test_vbscript_scheme_blocked(self):
        result = _validate_url("vbscript:msgbox('xss')")
        assert result is not None

    def test_file_scheme_blocked(self):
        result = _validate_url("file:///etc/passwd")
        assert result is not None

    def test_ftp_scheme_blocked(self):
        result = _validate_url("ftp://example.com/file.mp4")
        assert result is not None

    def test_script_tag_injection_blocked(self):
        result = _validate_url("<script>alert(1)</script>")
        assert result is not None

    def test_onload_injection_blocked(self):
        result = _validate_url("onload=alert(1)")
        assert result is not None

    def test_url_without_hostname_is_invalid(self):
        result = _validate_url("https:///path/only")
        assert result is not None

    def test_localhost_blocked(self):
        result = _validate_url("http://localhost/admin")
        assert result is not None

    def test_loopback_ip_blocked(self):
        result = _validate_url("http://127.0.0.1/secret")
        assert result is not None


# ---------------------------------------------------------------------------
# _url_hash
# ---------------------------------------------------------------------------

class TestUrlHash:
    """_url_hash must return a consistent, case-normalised hex digest."""

    def test_returns_hex_string(self):
        h = _url_hash("https://example.com/video")
        assert isinstance(h, str)
        assert all(c in "0123456789abcdef" for c in h)

    def test_same_url_same_hash(self):
        url = "https://www.youtube.com/watch?v=abc"
        assert _url_hash(url) == _url_hash(url)

    def test_case_normalised(self):
        assert _url_hash("HTTPS://EXAMPLE.COM/VIDEO") == _url_hash("https://example.com/video")

    def test_different_urls_different_hashes(self):
        assert _url_hash("https://example.com/a") != _url_hash("https://example.com/b")

    def test_hash_length_is_64(self):
        # SHA-256 hex digest is always 64 characters
        assert len(_url_hash("https://example.com/")) == 64


# ---------------------------------------------------------------------------
# _get_cached_download / _cache_completed_download
# ---------------------------------------------------------------------------

class TestDownloadCache:
    """Deduplication cache helpers must read and write correctly."""

    def setup_method(self):
        # Clear global state before each test
        with downloads_lock:
            _download_url_cache.clear()
            downloads.clear()

    def teardown_method(self):
        with downloads_lock:
            _download_url_cache.clear()
            downloads.clear()

    def test_cache_miss_returns_none(self):
        with downloads_lock:
            result = _get_cached_download("https://example.com/new-video")
        assert result is None

    def test_cache_hit_returns_entry(self):
        url = "https://example.com/video1"
        with downloads_lock:
            _cache_completed_download(url, "dl-123", None)
            result = _get_cached_download(url)
        assert result is not None
        assert result["download_id"] == "dl-123"

    def test_cache_invalidated_when_file_missing(self):
        url = "https://example.com/video2"
        with downloads_lock:
            _cache_completed_download(url, "dl-456", "nonexistent_file.mp4")
            result = _get_cached_download(url)
        assert result is None

    def test_cache_invalidated_after_ttl(self):
        url = "https://example.com/video3"
        with downloads_lock:
            _cache_completed_download(url, "dl-789", None)
            # Manually backdate the cache entry
            from api.app import _url_hash as uh
            h = uh(url)
            _download_url_cache[h]["cached_at"] = time.time() - 9999
            result = _get_cached_download(url)
        assert result is None

    def test_cache_valid_file_returns_entry(self):
        url = "https://example.com/video4"
        # Create a real temporary file to satisfy the file-existence check
        with tempfile.NamedTemporaryFile(dir=DOWNLOAD_FOLDER, suffix=".mp4", delete=False) as f:
            tmp_name = os.path.basename(f.name)
        try:
            with downloads_lock:
                _cache_completed_download(url, "dl-real", tmp_name)
                result = _get_cached_download(url)
            assert result is not None
            assert result["filename"] == tmp_name
        finally:
            os.unlink(os.path.join(DOWNLOAD_FOLDER, tmp_name))


# ---------------------------------------------------------------------------
# _with_exponential_backoff
# ---------------------------------------------------------------------------

class TestExponentialBackoff:
    """_with_exponential_backoff must retry the correct number of times."""

    def test_succeeds_on_first_attempt(self):
        calls = []

        def fn():
            calls.append(1)
            return "ok"

        result = _with_exponential_backoff(fn, max_retries=3, delays=(0, 0, 0))
        assert result == "ok"
        assert len(calls) == 1

    def test_retries_and_eventually_succeeds(self):
        calls = []

        def fn():
            calls.append(1)
            if len(calls) < 3:
                raise ValueError("transient")
            return "done"

        result = _with_exponential_backoff(
            fn, max_retries=3, delays=(0, 0, 0), retriable_exc=(ValueError,)
        )
        assert result == "done"
        assert len(calls) == 3

    def test_raises_after_max_retries_exhausted(self):
        calls = []

        def fn():
            calls.append(1)
            raise RuntimeError("always fails")

        with pytest.raises(RuntimeError, match="always fails"):
            _with_exponential_backoff(
                fn, max_retries=2, delays=(0, 0), retriable_exc=(RuntimeError,)
            )
        assert len(calls) == 3  # 1 initial + 2 retries

    def test_non_retriable_exception_propagates_immediately(self):
        calls = []

        def fn():
            calls.append(1)
            raise KeyError("not retriable")

        with pytest.raises(KeyError):
            _with_exponential_backoff(
                fn, max_retries=3, delays=(0, 0, 0), retriable_exc=(ValueError,)
            )
        assert len(calls) == 1  # Must NOT retry for non-retriable exceptions

    def test_delays_are_respected(self):
        calls = []

        def fn():
            calls.append(time.monotonic())
            if len(calls) < 3:
                raise OSError("retry me")

        _with_exponential_backoff(fn, max_retries=3, delays=(0.05, 0.1, 0.2), retriable_exc=(OSError,))
        assert len(calls) == 3
        # Second call must be at least 0.05s after first
        assert calls[1] - calls[0] >= 0.04
        # Third call must be at least 0.1s after second
        assert calls[2] - calls[1] >= 0.09


# ---------------------------------------------------------------------------
# _CircuitBreaker
# ---------------------------------------------------------------------------

class TestCircuitBreaker:
    """_CircuitBreaker must implement the open/closed/half-open state machine."""

    def test_starts_closed(self):
        cb = _CircuitBreaker(threshold=5, cooldown=300)
        assert not cb.is_open()

    def test_opens_after_threshold_failures(self):
        cb = _CircuitBreaker(threshold=5, cooldown=300)
        for _ in range(5):
            cb.record_failure()
        assert cb.is_open()

    def test_does_not_open_before_threshold(self):
        cb = _CircuitBreaker(threshold=5, cooldown=300)
        for _ in range(4):
            cb.record_failure()
        assert not cb.is_open()

    def test_success_resets_circuit(self):
        cb = _CircuitBreaker(threshold=5, cooldown=300)
        for _ in range(5):
            cb.record_failure()
        assert cb.is_open()
        cb.record_success()
        assert not cb.is_open()
        assert cb.failure_count == 0

    def test_circuit_closes_after_cooldown(self):
        cb = _CircuitBreaker(threshold=2, cooldown=0.05)
        cb.record_failure()
        cb.record_failure()
        assert cb.is_open()
        time.sleep(0.1)
        assert not cb.is_open()

    def test_failure_count_increments(self):
        cb = _CircuitBreaker(threshold=10, cooldown=300)
        for i in range(3):
            cb.record_failure()
        assert cb.failure_count == 3

    def test_thread_safety(self):
        cb = _CircuitBreaker(threshold=100, cooldown=300)
        errors = []

        def worker():
            try:
                for _ in range(10):
                    cb.record_failure()
                    cb.is_open()
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert not errors
        assert cb.failure_count == 100

    def test_global_instance_is_circuit_breaker(self):
        assert isinstance(_extractor_circuit_breaker, _CircuitBreaker)


# ---------------------------------------------------------------------------
# /health endpoint
# ---------------------------------------------------------------------------

class TestHealthEndpoint:
    """The /health endpoint must return a structured response with subsystem checks."""

    def test_healthy_response_structure(self):
        response = asyncio.run(health())
        body = response.body
        import json
        data = json.loads(body)
        assert "status" in data
        assert "timestamp" in data
        assert "version" in data
        assert "checks" in data
        checks = data["checks"]
        assert "yt_dlp" in checks
        assert "disk" in checks
        assert "network" in checks
        assert "circuit_breaker" in checks

    def test_yt_dlp_check_is_ok(self):
        response = asyncio.run(health())
        import json
        data = json.loads(response.body)
        assert data["checks"]["yt_dlp"]["ok"] is True
        assert "version" in data["checks"]["yt_dlp"]

    def test_circuit_breaker_check_ok_when_closed(self):
        # Ensure the global circuit breaker is in a known-good state
        _extractor_circuit_breaker.record_success()
        response = asyncio.run(health())
        import json
        data = json.loads(response.body)
        assert data["checks"]["circuit_breaker"]["ok"] is True
        assert data["checks"]["circuit_breaker"]["open"] is False

    def test_circuit_breaker_check_fails_when_open(self):
        # Force the circuit open by simulating threshold failures on a local instance
        # We don't touch the global CB here; instead we patch is_open.
        with patch.object(_extractor_circuit_breaker, "is_open", return_value=True):
            response = asyncio.run(health())
        import json
        data = json.loads(response.body)
        assert data["checks"]["circuit_breaker"]["ok"] is False
        assert data["checks"]["circuit_breaker"]["open"] is True
        assert response.status_code == 503

    def test_disk_check_present(self):
        response = asyncio.run(health())
        import json
        data = json.loads(response.body)
        disk = data["checks"]["disk"]
        assert "ok" in disk
        assert "free_mb" in disk

    def test_status_200_when_healthy(self):
        with patch.object(_extractor_circuit_breaker, "is_open", return_value=False):
            with patch("shutil.disk_usage") as mock_du:
                mock_du.return_value = MagicMock(free=2 * 1024 * 1024 * 1024)
                response = asyncio.run(health())
        assert response.status_code == 200
        import json
        data = json.loads(response.body)
        assert data["status"] == "healthy"

    def test_status_503_when_disk_critically_low(self):
        with patch.object(_extractor_circuit_breaker, "is_open", return_value=False):
            with patch("shutil.disk_usage") as mock_du:
                mock_du.return_value = MagicMock(free=50 * 1024 * 1024)  # 50 MB < 100 MB threshold
                response = asyncio.run(health())
        assert response.status_code == 503
        import json
        data = json.loads(response.body)
        assert data["status"] == "degraded"


# ---------------------------------------------------------------------------
# Default format spec and queue behaviour
# ---------------------------------------------------------------------------

class TestDefaultFormatSpec:
    """The download engine must default to bv*+ba/b (best video + best audio)."""

    def test_default_format_is_bv_plus_ba(self):
        from api.app import normalize_format_spec
        # bv*+ba/b already contains '/' so it must be returned unchanged
        assert normalize_format_spec("bv*+ba/b") == "bv*+ba/b"

    def test_bv_plus_ba_passes_through_normalize(self):
        from api.app import normalize_format_spec
        # Confirm the fallback logic does not append an extra '/best'
        result = normalize_format_spec("bv*+ba/b")
        assert result.count("/") == 1


class TestQueueFullMessage:
    """When the download queue is full the API must return the 'Waiting' message."""

    def test_queue_full_returns_waiting_message(self):
        import asyncio
        import json
        from types import SimpleNamespace
        from unittest.mock import patch
        from api.app import start_download, _download_queue

        request = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))

        with patch.object(_download_queue, "full", return_value=True):
            response = asyncio.run(
                start_download(
                    request=request,
                    url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    format="bv*+ba/b",
                    ext="mp4",
                    session_id=None,
                )
            )

        assert response.status_code == 429
        body = json.loads(response.body)
        assert body["error"] == "Waiting for available slot…"

    def test_queue_full_message_not_old_message(self):
        import asyncio
        import json
        from types import SimpleNamespace
        from unittest.mock import patch
        from api.app import start_download, _download_queue

        request = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))

        with patch.object(_download_queue, "full", return_value=True):
            response = asyncio.run(
                start_download(
                    request=request,
                    url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    format="bv*+ba/b",
                    ext="mp4",
                    session_id=None,
                )
            )

        body = json.loads(response.body)
        assert "queue is full" not in body["error"].lower()


class TestMaxConcurrentDownloadsDefault:
    """MAX_CONCURRENT_DOWNLOADS default must be 5 (within the 3–5 per-server range)."""

    def test_default_concurrent_limit_is_five(self):
        from api.app import Config
        import os
        # Only test the Python-level default, not an overridden env value
        if "MAX_CONCURRENT_DOWNLOADS" not in os.environ:
            assert Config.MAX_CONCURRENT_DOWNLOADS == 5
        else:
            assert 3 <= Config.MAX_CONCURRENT_DOWNLOADS <= 10

