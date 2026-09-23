"""Gallery access follows current account and approved team membership."""
from django.db.models import Q
from django.http import JsonResponse

from api.models import Account, Team, TeamMembership
from api.views_shared import _require_role


def require_gallery_access(request):
    account, error = _require_role(
        request, Account.ROLE_ADMIN, Account.ROLE_COLLAB, Account.ROLE_PARTICIPANT,
    )
    if error:
        return error
    if account.role != Account.ROLE_PARTICIPANT:
        return None

    # Prefer the explicit account link, with MSSV support for legacy unlinked
    # profiles. Never use a profile linked to a different account.
    identity = Q(participant__account=account)
    if account.mssv:
        identity |= Q(participant__account__isnull=True, participant__mssv=account.mssv)
    if TeamMembership.objects.filter(identity, team__approval_status=Team.APPROVAL_APPROVED).exists():
        return None
    return JsonResponse({"error": "team_not_approved"}, status=403)
