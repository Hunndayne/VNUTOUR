"""Read-only Drive access. Never request a URL supplied by a browser."""
import hashlib
import re
import time
from urllib.parse import parse_qs, urlparse

from django.conf import settings
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
import requests

from .errors import GalleryError

ID = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
FIELDS = "id,name,mimeType,size,version,modifiedTime,md5Checksum,resourceKey,webViewLink,webContentLink,trashed,parents,capabilities(canDownload)"
MIMES = {"image/jpeg", "image/png", "image/webp"}


def parse_folder(value):
    if not isinstance(value, str) or len(value) > 1000:
        raise GalleryError("invalid_drive_folder")
    try:
        url = urlparse(value.strip())
        invalid_authority = url.hostname != "drive.google.com" or url.username or url.password or url.port
    except ValueError as exc:
        # Accessing hostname/port validates malformed IPv6 and non-numeric ports.
        raise GalleryError("invalid_drive_folder") from exc
    if url.scheme != "https" or invalid_authority:
        raise GalleryError("invalid_drive_folder")
    match = re.fullmatch(r"/drive/(?:u/\d+/)?folders/([A-Za-z0-9_-]+)/*", url.path)
    if not match or not ID.fullmatch(match[1]):
        raise GalleryError("invalid_drive_folder")
    key = parse_qs(url.query).get("resourcekey", [""])[0]
    if key and not ID.fullmatch(key):
        raise GalleryError("invalid_drive_folder")
    return match[1], key


def safe_drive_link(value):
    if not value or not isinstance(value, str) or len(value) > 2000:
        return ""
    try:
        url = urlparse(value)
        valid = (
            url.scheme == "https"
            and url.hostname in {"drive.google.com", "drive.usercontent.google.com"}
            and not url.username
            and not url.password
            and not url.port
        )
    except ValueError:
        return ""
    return value if valid else ""


def revision(item):
    # Drive version is the primary generation. The remaining immutable metadata
    # keeps tests/local providers safe if they omit version.
    return ":".join(str(item.get(name) or "") for name in ("version", "md5Checksum", "modifiedTime", "size"))


def _json(response):
    try:
        value = response.json()
    except (ValueError, requests.RequestException) as exc:
        raise GalleryError("drive_unavailable", retryable=True) from exc
    if not isinstance(value, dict):
        raise GalleryError("drive_unavailable", retryable=True)
    return value


class Drive:
    def __init__(self):
        if not settings.PHOTO_DRIVE_CREDENTIALS:
            raise GalleryError("drive_not_configured")
        try:
            credentials = service_account.Credentials.from_service_account_file(
                settings.PHOTO_DRIVE_CREDENTIALS, scopes=["https://www.googleapis.com/auth/drive.readonly"],
            )
            self.session = AuthorizedSession(credentials)
        except (OSError, ValueError) as exc:
            raise GalleryError("drive_not_configured") from exc

    def _get(self, path, *, params=None, resource_keys=None, stream=False):
        headers = {}
        if resource_keys:
            headers["X-Goog-Drive-Resource-Keys"] = ",".join(f"{fid}/{key}" for fid, key in resource_keys if key)
        try:
            response = self.session.get(
                "https://www.googleapis.com/drive/v3/" + path,
                params=params, headers=headers, timeout=(10, 40), stream=stream,
            )
        except (requests.RequestException, GoogleAuthError, OSError) as exc:
            # Google auth failures must not leak credential/response content.
            raise GalleryError("drive_unavailable", retryable=True) from exc
        if response.status_code == 429 or response.status_code >= 500:
            response.close()
            raise GalleryError("drive_unavailable", retryable=True)
        if response.status_code == 403:
            try:
                reasons = [e.get("reason") for e in _json(response).get("error", {}).get("errors", [])]
            except GalleryError:
                reasons = []
            response.close()
            if any(r in {"rateLimitExceeded", "userRateLimitExceeded", "downloadQuotaExceeded"} for r in reasons):
                raise GalleryError("drive_unavailable", retryable=True)
            raise GalleryError("drive_permission_denied")
        if response.status_code in {401, 404}:
            response.close()
            raise GalleryError("drive_permission_denied")
        if not response.ok:
            response.close()
            raise GalleryError("drive_unavailable", retryable=True)
        return response

    def get(self, file_id, resource_key=""):
        with self._get(f"files/{file_id}", params={"fields": FIELDS, "supportsAllDrives": "true"}, resource_keys=[(file_id, resource_key)]) as response:
            return _json(response)

    def list_page(self, folder_id, resource_key="", page_token=""):
        folder = self.get(folder_id, resource_key)
        if folder.get("trashed") or folder.get("mimeType") != "application/vnd.google-apps.folder":
            raise GalleryError("invalid_drive_folder")
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": f"nextPageToken,incompleteSearch,files({FIELDS})", "pageSize": 100,
            "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
        }
        if page_token:
            params["pageToken"] = page_token
        with self._get("files", params=params, resource_keys=[(folder_id, resource_key)]) as response:
            result = _json(response)
        if result.get("incompleteSearch"):
            raise GalleryError("drive_unavailable", retryable=True)
        if not isinstance(result.get("files", []), list):
            raise GalleryError("drive_unavailable", retryable=True)
        return result

    def download(self, photo, output, *, heartbeat=None):
        if heartbeat:
            heartbeat()
        before = self.get(photo.drive_file_id, photo.resource_key)
        if before.get("trashed") or photo.album.folder_id not in before.get("parents", []):
            raise GalleryError("source_unavailable")
        if before.get("mimeType") not in MIMES or not before.get("capabilities", {}).get("canDownload", False):
            raise GalleryError("drive_permission_denied")
        if revision(before) != photo.source_revision:
            raise GalleryError("source_changed")
        try:
            declared_size = int(before.get("size", 0))
        except (TypeError, ValueError) as exc:
            raise GalleryError("source_changed") from exc
        if declared_size < 0 or declared_size > settings.PHOTO_MAX_IMAGE_BYTES:
            raise GalleryError("reference_too_large")
        digest = hashlib.md5(usedforsecurity=False)
        total, start = 0, time.monotonic()
        try:
            with self._get(f"files/{photo.drive_file_id}", params={"alt": "media", "supportsAllDrives": "true"}, resource_keys=[(photo.drive_file_id, photo.resource_key)], stream=True) as response:
                for chunk in response.iter_content(64 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > settings.PHOTO_MAX_IMAGE_BYTES:
                        raise GalleryError("reference_too_large")
                    if time.monotonic() - start > 120:
                        raise GalleryError("drive_unavailable", retryable=True)
                    digest.update(chunk)
                    output.write(chunk)
                    if heartbeat:
                        heartbeat()
        except requests.RequestException as exc:
            raise GalleryError("drive_unavailable", retryable=True) from exc
        if heartbeat:
            heartbeat(force=True)
        after = self.get(photo.drive_file_id, photo.resource_key)
        if revision(after) != photo.source_revision or after.get("trashed") or photo.album.folder_id not in after.get("parents", []):
            raise GalleryError("source_changed")
        if total != declared_size or (before.get("md5Checksum") and digest.hexdigest() != before["md5Checksum"]):
            raise GalleryError("source_changed")
        output.seek(0)
