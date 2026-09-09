"""Read-only account dossier, available to admins as encrypted responses only."""
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, Participant, TeamMembership
from api.services.account_detail_encryption import encrypt_account_details, load_browser_public_key
from api.services.audit_service import record_audit
from api.services.registration_service import get_schema
from api.views_shared import _json_body, _require_role


def _date(value):
    return value.isoformat() if value else None


def _account_details(target):
    # Never infer ownership from mutable email/MSSV text.
    profile = Participant.objects.filter(account_id=target.pk).first()
    membership = TeamMembership.objects.filter(participant=profile).select_related("team").first() if profile else None
    account = {field: getattr(target, field) for field in (
        "id", "username", "email", "mssv", "full_name", "phone", "school", "faculty",
        "avatar", "role", "is_active",
    )}
    account.update({
        "google_linked": bool(target.google_sub),
        "created_at": _date(target.created_at), "updated_at": _date(target.updated_at),
        "last_login": _date(target.last_login),
    })
    participant = None
    if profile:
        participant = {field: getattr(profile, field) for field in (
            "id", "mssv", "full_name", "email", "phone", "school", "faculty",
            "facebook", "cccd", "discord_username", "extra",
        )}
        participant.update({
            "discord_id": str(profile.discord_id) if profile.discord_id else None,
            "date_of_birth": _date(profile.date_of_birth),
            "created_at": _date(profile.created_at), "updated_at": _date(profile.updated_at),
        })
    team = None
    if membership:
        team = {
            "id": membership.team_id, "code": membership.team.code, "name": membership.team.name,
            "approval_status": membership.team.approval_status,
            "is_captain": membership.is_captain, "team_number": membership.team_number,
            "joined_at": _date(membership.created_at),
            "payment_confirmed_at": _date(membership.team.payment_confirmed_at),
        }
    return {
        "account": account, "participant": participant, "team": team,
        "identity_mismatches": [
            field for field in ("mssv", "email", "full_name")
            if profile and (getattr(profile, field) or "") != (getattr(target, field) or "")
        ],
        "extra_labels": {
            field["key"]: field.get("label") or field["key"]
            for field in get_schema().get("person_fields", []) if field.get("key")
        },
    }


@csrf_exempt
@never_cache
def admin_account_details_view(request, username):
    actor, error = _require_role(request, Account.ROLE_ADMIN)
    if error:
        return error
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    if len(request.body) > 4096:
        return JsonResponse({"error": "invalid_public_key"}, status=400)
    data = _json_body(request)
    if not isinstance(data, dict):
        return JsonResponse({"error": "invalid_json"}, status=400)
    try:
        key = load_browser_public_key(data.get("public_key"))
    except ValueError:
        return JsonResponse({"error": "invalid_public_key"}, status=400)
    try:
        target = Account.objects.get(username__iexact=username)
    except Account.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)
    encrypted = encrypt_account_details(_account_details(target), key, username=username)
    # Record the access, never the decrypted dossier, public key or ciphertext.
    record_audit(
        actor=actor, action="account.details_viewed", summary="Viewed account details",
        target_type="account", target_id=target.pk,
    )
    response = JsonResponse(encrypted)
    response["Referrer-Policy"] = "no-referrer"
    return response
