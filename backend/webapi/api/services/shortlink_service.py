"""Business logic for the admin-managed link shortener (`/s/<code>`).

Links are a comms tool: an admin turns one long URL (Google Form, Discord
invite, deep SPA link) into a short, printable `/s/<code>` and every hop is
counted, so posters / QR codes / captions can be compared afterwards. The
redirect itself is served by `views_shortlink.short_link_redirect_view` from
the Django root urls (outside `/api/`) because a short link must not carry the
`/api` prefix — nginx proxies `/s/` the same way it proxies `/api/`.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone as _timezone
from urllib.parse import urlsplit

from django.db.models import F
from django.http import HttpRequest
from django.utils import timezone

from api.models import ShortLink

# Unambiguous alphabet (no 0/O/1/l/I) so codes stay readable when printed
# small on posters or read out loud.
CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
CODE_LENGTH = 6
MAX_GENERATE_ATTEMPTS = 8

CUSTOM_CODE_RE = re.compile(r"^[a-z0-9_-]{3,32}$")

# Error codes surfaced to the admin UI (Vietnamese copy lives in the FE).
ERR_INVALID_URL = "invalid_url"
ERR_INVALID_CODE = "invalid_code"
ERR_CODE_TAKEN = "code_taken"
ERR_INVALID_EXPIRY = "invalid_expiry"


def _iso(dt: datetime | None) -> str | None:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_timezone.utc)
    return dt.astimezone(_timezone.utc).isoformat()


def _parse_expires(value) -> datetime | None:
    """Accepts None/"" (clear), or an ISO-8601 string from a datetime-local
    input. Raises ValueError on anything else — the views map it to a 400."""
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError(ERR_INVALID_EXPIRY)
    text = value.strip()
    # datetime-local submits "2026-09-01T09:00" with no zone; the event runs
    # in Vietnam, so read naive input as local time.
    try:
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(ERR_INVALID_EXPIRY)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.get_current_timezone())
    return parsed.astimezone(_timezone.utc)


def normalize_target_url(raw) -> str:
    """Validate + canonicalise a target URL. Raises ValueError with an error
    code for the FE. A missing scheme is assumed https — the typical paste is
    a bare domain — but only http(s) targets are accepted so `/s/x` can never
    be coerced into `javascript:` or `data:` content on this origin."""
    if not isinstance(raw, str):
        raise ValueError(ERR_INVALID_URL)
    text = raw.strip()
    if not text:
        raise ValueError(ERR_INVALID_URL)
    raw_parts = urlsplit(text)
    if raw_parts.scheme:
        # An explicit scheme must be http(s) — this is also what keeps
        # `javascript:` / `data:` from ever being served off this origin.
        if raw_parts.scheme not in ("http", "https"):
            raise ValueError(ERR_INVALID_URL)
    else:
        # A bare domain is the typical paste; assume https.
        text = f"https://{text}"
    parts = urlsplit(text)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError(ERR_INVALID_URL)
    if len(text) > 2048:
        raise ValueError(ERR_INVALID_URL)
    return text


def normalize_code(raw) -> str:
    if not isinstance(raw, str):
        raise ValueError(ERR_INVALID_CODE)
    code = raw.strip().lower()
    if not CUSTOM_CODE_RE.match(code):
        raise ValueError(ERR_INVALID_CODE)
    return code


def _random_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def create_link(
    *,
    target_url: str,
    code: str | None = None,
    label: str = "",
    expires_at=None,
    account=None,
) -> ShortLink:
    target = normalize_target_url(target_url)
    expires = _parse_expires(expires_at)
    note = (label or "").strip()[:200]

    if code:
        code = normalize_code(code)
        if ShortLink.objects.filter(code=code).exists():
            raise ValueError(ERR_CODE_TAKEN)
        return ShortLink.objects.create(
            code=code, target_url=target, label=note,
            expires_at=expires, created_by=account,
        )

    # Auto code: retry on the (unlikely) collision instead of pre-checking,
    # so two admins creating at once can't grab the same code.
    for _ in range(MAX_GENERATE_ATTEMPTS):
        link = ShortLink.objects.create(
            code=_random_code(), target_url=target, label=note,
            expires_at=expires, created_by=account,
        )
        return link
    raise ValueError(ERR_CODE_TAKEN)


# `_parse_expires(None)` clears the field, but `update_link(expires_at=UNSET)`
# must mean "leave unchanged" so the other fields stay patchable. Views pass
# None or a string only when the payload actually carries an expiry value.
UNSET = object()


def update_link(
    link: ShortLink,
    *,
    target_url=None,
    label=None,
    is_active=None,
    expires_at=UNSET,
    code=None,
) -> ShortLink:
    if target_url is not None:
        link.target_url = normalize_target_url(target_url)
    if label is not None:
        link.label = str(label).strip()[:200]
    if is_active is not None:
        link.is_active = bool(is_active)
    if expires_at is not UNSET:
        link.expires_at = _parse_expires(expires_at)
    if code is not None and str(code).strip():
        new_code = normalize_code(code)
        if (
            new_code != link.code
            and ShortLink.objects.filter(code=new_code).exists()
        ):
            raise ValueError(ERR_CODE_TAKEN)
        link.code = new_code
    link.save()
    return link


def resolve_link(code: str) -> tuple[ShortLink | None, str | None]:
    """Look up a live link by code. Returns (link, None) or (None, error)
    where error ∈ not_found / inactive / expired."""
    try:
        link = ShortLink.objects.get(code=str(code or "").strip().lower())
    except ShortLink.DoesNotExist:
        return None, "not_found"
    if not link.is_active:
        return None, "inactive"
    if link.expires_at is not None and link.expires_at <= timezone.now():
        return None, "expired"
    return link, None


def record_click(link: ShortLink) -> None:
    ShortLink.objects.filter(pk=link.pk).update(
        click_count=F("click_count") + 1,
        last_clicked_at=timezone.now(),
    )


def serialize_link(link: ShortLink, request: HttpRequest | None = None) -> dict:
    path = f"/s/{link.code}"
    short_url = request.build_absolute_uri(path) if request is not None else path
    return {
        "id": link.id,
        "code": link.code,
        "short_url": short_url,
        "target_url": link.target_url,
        "label": link.label,
        "is_active": link.is_active,
        "expires_at": _iso(link.expires_at),
        "click_count": link.click_count,
        "last_clicked_at": _iso(link.last_clicked_at),
        "created_by": link.created_by.username if link.created_by_id else None,
        "created_at": _iso(link.created_at),
        "updated_at": _iso(link.updated_at),
    }


def list_links() -> list[dict]:
    return [serialize_link(link) for link in ShortLink.objects.all()]
