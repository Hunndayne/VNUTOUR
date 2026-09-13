"""Authenticated delivery of locally-stored submission files.

These used to be handed to `django.views.static.serve` straight off MEDIA_ROOT,
with no auth at all. The filenames carry a UUID, but an unguessable URL is not an
access control: it leaks through browser history, referrers, chat previews and
anyone the link is forwarded to, and it never expires.

Local keys are written as `submissions/st{station_id}/{team_code}/{uuid}_{name}`
by `submission_storage_service`, which is enough to answer "who may see this":
staff who run the station, and the team that uploaded it.
"""

from __future__ import annotations

import posixpath
import re
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpRequest, JsonResponse

from api.models import Account, Station, StationAssignment, Team, TeamMembership
from .views_shared import _auth_or_401

SUBMISSION_KEY = re.compile(r"^submissions/st(?P<station_id>\d+)/(?P<team_code>[^/]+)/[^/]+$")
FEED_KEY = re.compile(r"^feed/[^/]+$")


def _forbidden():
    return JsonResponse({"error": "forbidden"}, status=403)


def _not_found():
    return JsonResponse({"error": "not_found"}, status=404)


def _may_read(acc: Account, station_id: int, team_code: str) -> bool:
    if acc.role in (Account.ROLE_ADMIN, Account.ROLE_MASTER_ADMIN):
        return True

    if acc.role == Account.ROLE_COLLAB:
        return StationAssignment.objects.filter(
            collab=acc, station_id=station_id, active=True,
        ).exists()

    if acc.role == Account.ROLE_PARTICIPANT and acc.mssv:
        # Their own team's upload, and only while they are still on that team.
        return TeamMembership.objects.filter(
            participant__mssv=acc.mssv, team__code=team_code,
        ).exists()

    return False


def submission_media_view(request: HttpRequest, path: str):
    """GET a stored submission file, if the caller is allowed to see it."""
    if request.method not in ("GET", "HEAD"):
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    # Normalise first: `..` segments must not escape MEDIA_ROOT, and the
    # normalised form is what the key pattern has to match.
    key = posixpath.normpath(path.replace("\\", "/")).lstrip("/")
    if key.startswith("../") or ".." in key.split("/"):
        return _not_found()

    root = Path(settings.MEDIA_ROOT).resolve()

    # Feed images are public announcement assets (covers + inline body images),
    # loaded from <img> tags that can't carry the Authorization header. Serve
    # them without the submission auth gate — same posture as frame images.
    if FEED_KEY.match(key):
        target = (root / key).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            return _not_found()
        return FileResponse(target.open("rb"))

    # Submissions are private team files — require auth and per-file authZ.
    acc, err = _auth_or_401(request)
    if err:
        return err

    match = SUBMISSION_KEY.match(key)
    if not match:
        return _not_found()

    station_id = int(match.group("station_id"))
    team_code = match.group("team_code")

    if not Station.objects.filter(id=station_id).exists():
        return _not_found()
    if not Team.objects.filter(code=team_code).exists():
        return _not_found()
    if not _may_read(acc, station_id, team_code):
        return _forbidden()

    root = Path(settings.MEDIA_ROOT).resolve()
    target = (root / key).resolve()
    # Belt and braces: even after normalising, refuse anything outside the root.
    if not target.is_relative_to(root) or not target.is_file():
        return _not_found()

    return FileResponse(target.open("rb"))
