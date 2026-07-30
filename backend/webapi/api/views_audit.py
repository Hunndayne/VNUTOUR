from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, AuditLog
from api.services.audit_service import serialize_audit, undo_audit
from .views_shared import _require_role


def audit_logs_view(request: HttpRequest):
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    queryset = AuditLog.objects.select_related(
        "actor", "undone_by", "undo_audit",
    )
    action = str(request.GET.get("action") or "").strip()
    if action:
        queryset = queryset.filter(action=action)
    actor = str(request.GET.get("actor") or "").strip()
    if actor:
        queryset = queryset.filter(actor__username__iexact=actor)
    if request.GET.get("reversible") in ("1", "true", "yes"):
        queryset = queryset.filter(reversible=True)

    try:
        page = max(1, int(request.GET.get("page", "1")))
        limit = max(1, min(200, int(request.GET.get("limit", "50"))))
    except (TypeError, ValueError):
        page, limit = 1, 50
    offset = (page - 1) * limit
    total = queryset.count()
    items = queryset[offset:offset + limit]
    return JsonResponse({
        "items": [serialize_audit(item) for item in items],
        "page": page,
        "limit": limit,
        "total": total,
    })


@csrf_exempt
def audit_undo_view(request: HttpRequest, audit_id: int):
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    try:
        log = undo_audit(audit_id, acc)
    except AuditLog.DoesNotExist:
        return JsonResponse({"error": "audit_not_found"}, status=404)
    except ValueError as exc:
        code = str(exc)
        status = 409 if code in ("undo_conflict", "already_undone") else 400
        return JsonResponse({"error": code}, status=status)
    return JsonResponse(serialize_audit(log))
