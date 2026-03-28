"""Tests for S3-compatible object storage integration.

Verifies that:
  - _get_s3_client() returns None when S3 is not configured.
  - _get_s3_client() returns a boto3 client when all BUCKET_* vars are set.
  - _s3_upload_file() returns False when S3 is disabled.
  - _s3_upload_file() calls client.upload_file() and returns True on success.
  - _s3_upload_file() returns False and logs when upload raises an exception.
  - _s3_delete_file() returns False when S3 is disabled.
  - _s3_delete_file() calls client.delete_object() and returns True on success.
  - _s3_delete_file() returns False and logs when delete raises an exception.
  - _s3_presigned_url() returns None when S3 is disabled.
  - _s3_presigned_url() returns a URL string on success.
  - _s3_presigned_url() returns None when URL generation raises an exception.
  - _s3_object_exists() returns False when S3 is disabled.
  - _s3_object_exists() returns True when head_object succeeds.
  - _s3_object_exists() returns False when head_object raises ClientError.
  - BUCKET_* environment variables are read and exposed as module-level names.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

import api.app as app_module
from api.app import (
    _s3_upload_file,
    _s3_delete_file,
    _s3_presigned_url,
    _s3_object_exists,
    _get_s3_client,
    BUCKET_NAME,
    BUCKET_REGION,
    BUCKET_ENDPOINT,
    BUCKET_ACCESS_KEY_ID,
    BUCKET_SECRET_ACCESS_KEY,
)


# ---------------------------------------------------------------------------
# Helper: patch _S3_ENABLED and _s3_client_instance so tests are isolated
# ---------------------------------------------------------------------------

def _make_mock_client():
    """Return a MagicMock that mimics the boto3 S3 client interface."""
    client = MagicMock()
    client.upload_file = MagicMock(return_value=None)
    client.delete_object = MagicMock(return_value={})
    client.generate_presigned_url = MagicMock(
        return_value="https://example.com/presigned?key=file.mp4"
    )
    client.head_object = MagicMock(return_value={})
    return client


# ---------------------------------------------------------------------------
# Environment variable exposure
# ---------------------------------------------------------------------------

class TestBucketEnvVars:
    """BUCKET_* environment variables must be read from os.environ."""

    def test_bucket_name_is_string(self):
        assert isinstance(BUCKET_NAME, str)

    def test_bucket_region_is_string(self):
        assert isinstance(BUCKET_REGION, str)

    def test_bucket_endpoint_is_string(self):
        assert isinstance(BUCKET_ENDPOINT, str)

    def test_bucket_access_key_id_is_string(self):
        assert isinstance(BUCKET_ACCESS_KEY_ID, str)

    def test_bucket_secret_access_key_is_string(self):
        assert isinstance(BUCKET_SECRET_ACCESS_KEY, str)

    def test_env_var_propagates_to_module(self, monkeypatch):
        """If the env var is set, the module constant should reflect it."""
        # We can't easily re-import, so just verify the constant matches os.environ
        env_val = os.environ.get("BUCKET_NAME", "")
        assert BUCKET_NAME == env_val


# ---------------------------------------------------------------------------
# _get_s3_client
# ---------------------------------------------------------------------------

class TestGetS3Client:
    """_get_s3_client() must return None when S3 is not configured."""

    def test_returns_none_when_disabled(self):
        with patch.object(app_module, "_S3_ENABLED", False):
            assert _get_s3_client() is None

    def test_returns_client_when_enabled(self):
        mock_boto3 = MagicMock()
        mock_client = _make_mock_client()
        mock_boto3.client.return_value = mock_client

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "_s3_client_instance", None),
            patch.object(app_module, "boto3", mock_boto3),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch.object(app_module, "BUCKET_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE"),
            patch.object(app_module, "BUCKET_SECRET_ACCESS_KEY", "wJalrXUtnFEMI"),
            patch.object(app_module, "BUCKET_REGION", "us-east-1"),
            patch.object(app_module, "BUCKET_ENDPOINT", ""),
        ):
            result = _get_s3_client()
            assert result is mock_client
            mock_boto3.client.assert_called_once()

    def test_returns_client_when_enabled_with_endpoint(self):
        mock_boto3 = MagicMock()
        mock_client = _make_mock_client()
        mock_boto3.client.return_value = mock_client

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "_s3_client_instance", None),
            patch.object(app_module, "boto3", mock_boto3),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch.object(app_module, "BUCKET_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE"),
            patch.object(app_module, "BUCKET_SECRET_ACCESS_KEY", "wJalrXUtnFEMI"),
            patch.object(app_module, "BUCKET_REGION", "auto"),
            patch.object(app_module, "BUCKET_ENDPOINT", "https://s3.example.com"),
        ):
            result = _get_s3_client()
            assert result is mock_client
            _, kwargs = mock_boto3.client.call_args
            assert kwargs.get("endpoint_url") == "https://s3.example.com"


# ---------------------------------------------------------------------------
# _s3_upload_file
# ---------------------------------------------------------------------------

class TestS3UploadFile:
    """_s3_upload_file() must behave correctly in all scenarios."""

    def test_returns_false_when_s3_disabled(self, tmp_path):
        local = tmp_path / "video.mp4"
        local.write_bytes(b"data")
        with patch.object(app_module, "_S3_ENABLED", False):
            assert _s3_upload_file(str(local), "video.mp4") is False

    def test_uploads_file_and_returns_true(self, tmp_path):
        local = tmp_path / "video.mp4"
        local.write_bytes(b"data")
        mock_client = _make_mock_client()

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch("api.app._get_s3_client", return_value=mock_client),
        ):
            result = _s3_upload_file(str(local), "video.mp4")

        assert result is True
        mock_client.upload_file.assert_called_once_with(
            str(local), "test-bucket", "video.mp4"
        )

    def test_returns_false_on_exception(self, tmp_path):
        local = tmp_path / "video.mp4"
        local.write_bytes(b"data")
        mock_client = _make_mock_client()
        mock_client.upload_file.side_effect = Exception("network error")

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch("api.app._get_s3_client", return_value=mock_client),
        ):
            result = _s3_upload_file(str(local), "video.mp4")

        assert result is False


# ---------------------------------------------------------------------------
# _s3_delete_file
# ---------------------------------------------------------------------------

class TestS3DeleteFile:
    """_s3_delete_file() must behave correctly in all scenarios."""

    def test_returns_false_when_s3_disabled(self):
        with patch.object(app_module, "_S3_ENABLED", False):
            assert _s3_delete_file("video.mp4") is False

    def test_deletes_object_and_returns_true(self):
        mock_client = _make_mock_client()

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch("api.app._get_s3_client", return_value=mock_client),
        ):
            result = _s3_delete_file("video.mp4")

        assert result is True
        mock_client.delete_object.assert_called_once_with(
            Bucket="test-bucket", Key="video.mp4"
        )

    def test_returns_false_on_exception(self):
        mock_client = _make_mock_client()
        mock_client.delete_object.side_effect = Exception("S3 error")

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch("api.app._get_s3_client", return_value=mock_client),
        ):
            result = _s3_delete_file("video.mp4")

        assert result is False


# ---------------------------------------------------------------------------
# _s3_presigned_url
# ---------------------------------------------------------------------------

class TestS3PresignedUrl:
    """_s3_presigned_url() must return a URL when S3 is configured."""

    def test_returns_none_when_s3_disabled(self):
        with patch.object(app_module, "_S3_ENABLED", False):
            assert _s3_presigned_url("video.mp4") is None

    def test_returns_url_on_success(self):
        expected_url = "https://example.com/presigned?key=video.mp4"
        mock_client = _make_mock_client()
        mock_client.generate_presigned_url.return_value = expected_url

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch("api.app._get_s3_client", return_value=mock_client),
        ):
            result = _s3_presigned_url("video.mp4")

        assert result == expected_url
        mock_client.generate_presigned_url.assert_called_once_with(
            "get_object",
            Params={"Bucket": "test-bucket", "Key": "video.mp4"},
            ExpiresIn=3600,
        )

    def test_custom_expiry_is_forwarded(self):
        mock_client = _make_mock_client()
        mock_client.generate_presigned_url.return_value = "https://example.com/url"

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch("api.app._get_s3_client", return_value=mock_client),
        ):
            _s3_presigned_url("video.mp4", expires_in=7200)

        _, kwargs = mock_client.generate_presigned_url.call_args
        assert kwargs["ExpiresIn"] == 7200

    def test_returns_none_on_exception(self):
        mock_client = _make_mock_client()
        mock_client.generate_presigned_url.side_effect = Exception("AWS error")

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch("api.app._get_s3_client", return_value=mock_client),
        ):
            result = _s3_presigned_url("video.mp4")

        assert result is None


# ---------------------------------------------------------------------------
# _s3_object_exists
# ---------------------------------------------------------------------------

class TestS3ObjectExists:
    """_s3_object_exists() must correctly report object presence."""

    def test_returns_false_when_s3_disabled(self):
        with patch.object(app_module, "_S3_ENABLED", False):
            assert _s3_object_exists("video.mp4") is False

    def test_returns_true_when_head_object_succeeds(self):
        mock_client = _make_mock_client()

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch("api.app._get_s3_client", return_value=mock_client),
        ):
            result = _s3_object_exists("video.mp4")

        assert result is True
        mock_client.head_object.assert_called_once_with(
            Bucket="test-bucket", Key="video.mp4"
        )

    def test_returns_false_when_client_error_raised(self):
        from botocore.exceptions import ClientError

        mock_client = _make_mock_client()
        mock_client.head_object.side_effect = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
        )

        with (
            patch.object(app_module, "_S3_ENABLED", True),
            patch.object(app_module, "BUCKET_NAME", "test-bucket"),
            patch("api.app._get_s3_client", return_value=mock_client),
        ):
            result = _s3_object_exists("video.mp4")

        assert result is False
