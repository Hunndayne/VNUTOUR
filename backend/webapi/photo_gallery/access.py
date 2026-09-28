"""Gallery access follows current account and approved team membership."""
from django.db.models import Q
from django.http import JsonResponse

from api.models import Account, Team, TeamMembership
from api.views_shared import _require_role


# Staff (admin and collab) also browse and search hidden albums, e.g. to check
# an album before it goes public again; participants only ever see published.
STAFF_ALBUM_STATUSES = ("published", "hidden")
PUBLIC_ALBUM_STATUSES = ("published",)


def visible_album_statuses(account):
    return STAFF_ALBUM_STATUSES if account.role != Account.ROLE_PARTICIPANT else PUBLIC_ALBUM_STATUSES


def require_gallery_access(request):
    """Return (album statuses the caller may see, error response)."""
    account, error = _require_role(
        request, Account.ROLE_ADMIN, Account.ROLE_COLLAB, Account.ROLE_PARTICIPANT,
    )
    if error:
        return None, error
    statuses = visible_album_statuses(account)
    if account.role != Account.ROLE_PARTICIPANT:
        return statuses, None

    # Prefer the explicit account link, with MSSV support for legacy unlinked
    # profiles. Never use a profile linked to a different account.
    identity = Q(participant__account=account)
    if account.mssv:
        identity |= Q(participant__account__isnull=True, participant__mssv=account.mssv)
    if TeamMembership.objects.filter(identity, team__approval_status=Team.APPROVAL_APPROVED).exists():
        return statuses, None
    return None, JsonResponse({"error": "team_not_approved"}, status=403)
