"""One-time QR tokens: a scanned code stops working the moment it is used.

Last year a coop phone re-read the same QR still sitting on a participant's
screen and checked the team in twice. The only guard was a 2.5 second in-memory
dedupe in one browser tab, which a reload or a second phone walks straight past.

The fix is to make the code itself single-use. `Team.qr_token` is rotated after
every successful scan, so the string the camera already read no longer resolves
to anything and a re-read fails instead of repeating the action.

Rotation happens on **success only**. Burning the token on a rejected scan — the
wrong station, a locked phase — would make the participant fetch a fresh QR for
something that never happened, which reads as a bug to them.

`resolve_team` distinguishes "this was a QR and it is spent" from "this is not
anything we know", because the two need different words in front of a queue.
"""

from __future__ import annotations

from api.models import Team
from api.services.team_service import rotate_qr_token

TOKEN_PREFIXES = ("t:", "T:")

# Returned when the scanned string carried the QR prefix but matches no team:
# almost always a code that has already been used, rather than a typo.
ERROR_QR_SPENT = "qr_already_used"
ERROR_TEAM_NOT_FOUND = "team_not_found"


def looks_like_qr(raw_code: str) -> bool:
    return str(raw_code or "").strip().startswith(TOKEN_PREFIXES)


def strip_prefix(raw_code: str) -> str:
    clean = str(raw_code or "").strip()
    for prefix in TOKEN_PREFIXES:
        if clean.startswith(prefix):
            return clean[len(prefix):]
    return clean


def parse_scan(raw_code: str) -> tuple[str, int | None, str | None]:
    """Split a scanned string into its token, station and direction.

    A station QR now carries where and which way it is meant to be used, so a
    coop no longer picks the station from a dropdown or flips an enter/exit
    switch — the code itself says both. The shape is `t:<token>|s:<id>|d:in`
    (or `d:out`); an event-gate QR stays a bare `t:<token>` with neither segment.

    The token segment is returned untouched, prefix and all, so `resolve_team`
    and `consume` keep operating on it exactly as before.
    """
    clean = str(raw_code or "").strip()
    parts = clean.split("|")
    token = parts[0].strip()
    station_id: int | None = None
    direction: str | None = None
    for segment in parts[1:]:
        segment = segment.strip()
        if segment.startswith("s:"):
            try:
                station_id = int(segment[2:])
            except ValueError:
                station_id = None
        elif segment.startswith("d:"):
            value = segment[2:].strip().lower()
            if value in ("in", "out"):
                direction = value
    return token, station_id, direction


def resolve_team(raw_code: str) -> tuple[Team | None, str | None]:
    """Find the team a scanned string refers to.

    Returns (team, None), or (None, error_code). A bare team code still resolves
    so staff can key one in when a camera will not focus; only the QR path is
    single-use, since only the QR path is what a camera can re-read by itself.
    """
    clean = strip_prefix(raw_code)
    if not clean:
        return None, ERROR_TEAM_NOT_FOUND

    team = Team.objects.filter(qr_token=clean).first()
    if team:
        return team, None

    if looks_like_qr(raw_code):
        # Carried the QR prefix but matched nothing — the token behind it has
        # already been spent and rotated away.
        return None, ERROR_QR_SPENT

    team = Team.objects.filter(code=clean).first()
    if team:
        return team, None
    return None, ERROR_TEAM_NOT_FOUND


def consume(raw_code: str, team: Team) -> None:
    """Retire the scanned QR so the same image cannot be read again.

    Call once the scan has actually succeeded, inside its transaction. Typed team
    codes are left alone: there is no image for a camera to re-read, and rotating
    would knock out the QR the team still has open on their phone.
    """
    if looks_like_qr(raw_code):
        rotate_qr_token(team)
