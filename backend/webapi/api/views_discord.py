"""
Discord views — status, provisioning, broadcasts (§9.10).
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, Team
from api.services.discord_service import (
    get_provisioning_queue, retry_provision,
    create_broadcast, list_broadcasts,
    list_members, sync_member,
)
from .views_shared import _json_body, _auth_or_401, _require_role


def discord_status_view(request: HttpRequest):
    """GET: basic Discord bot status."""
    acc, err = _auth_or_401(request)
    if err:
        return err

    from api.models import Team
    pending = Team.objects.filter(provision_state=Team.PROVISION_PENDING).count()
    failed = Team.objects.filter(provision_state=Team.PROVISION_FAILED).count()
    done = Team.objects.filter(provision_state=Team.PROVISION_DONE).count()

    return JsonResponse({
        "provisioning": {
            "pending": pending,
            "failed": failed,
            "done": done,
        },
    })


def provisioning_queue_view(request: HttpRequest):
    """GET: teams waiting for Discord provisioning."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    return JsonResponse({"queue": get_provisioning_queue()})


@csrf_exempt
def retry_provision_view(request: HttpRequest, team_code: str):
    """POST: retry Discord provisioning for a team."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    try:
        team = retry_provision(team_code)
    except Team.DoesNotExist:
        return JsonResponse({"error": "team_not_found"}, status=404)

    return JsonResponse({
        "team_code": team.code,
        "provision_state": team.provision_state,
        "retry_count": team.provision_retry_count,
    })


def members_view(request: HttpRequest):
    """GET: list the web<->Discord member mapping."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err
    q = str((request.GET.get("q") or "").strip())
    linked = str((request.GET.get("linked") or "all").strip())
    try:
        limit = max(1, min(200, int(request.GET.get("limit", "100"))))
    except Exception:
        limit = 100
    items, counts = list_members(query=q, linked=linked, limit=limit)
    return JsonResponse({"items": items, "counts": counts})


@csrf_exempt
def member_sync_view(request: HttpRequest, mssv: str):
    """POST: (re)sync a member's Discord linkage."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    participant, err = sync_member(mssv)
    if err:
        return JsonResponse({"error": err}, status=404)

    return JsonResponse({
        "mssv": participant.mssv,
        "full_name": participant.full_name,
        "discord_id": participant.discord_id,
        "linked": participant.discord_id is not None,
    })


@csrf_exempt
def broadcast_create_view(request: HttpRequest):
    """GET: list broadcasts. POST: create draft broadcast."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        broadcasts = list_broadcasts()
        return JsonResponse({"items": broadcasts})

    if request.method == "POST":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        title = str((data.get("title") or "").strip())
        message = str((data.get("message") or "").strip())
        target = str((data.get("target") or "all").strip())

        if not title or not message:
            return JsonResponse({"error": "missing_fields"}, status=400)

        broadcast = create_broadcast(
            title=title, message=message, target=target,
            sent_by=acc, target_payload=data.get("target_payload"),
        )
        return JsonResponse({
            "id": broadcast.id, "title": broadcast.title,
            "status": broadcast.status,
        }, status=201)

    return JsonResponse({"error": "method_not_allowed"}, status=405)
