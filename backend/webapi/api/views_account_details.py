"""Admin account dossier reads and edits with encrypted payloads."""
from django.db import IntegrityError
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, Participant, TeamMembership
from api.services.account_detail_encryption import encrypt_account_details, load_browser_public_key
from api.services.account_edit_encryption import create_edit_grant, decrypt_edit_request, EditEncryptionError
from api.services.account_identity_service import AccountUpdateError, update_admin_account
from api.services.audit_service import record_audit
from api.services.registration_service import PERSON_COLUMN_KEYS, get_schema
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
    person_fields = get_schema().get("person_fields", [])
    return {
        "account": account, "participant": participant, "team": team,
        "identity_mismatches": [
            field for field in ("mssv", "email", "full_name")
            if profile and (getattr(profile, field) or "") != (getattr(target, field) or "")
        ],
        "extra_labels": {
            field["key"]: field.get("label") or field["key"]
            for field in person_fields if field.get("key")
        },
        "extra_fields": [
            {key: field[key] for key in ("key", "label", "type", "options", "enabled", "required") if key in field}
            for field in person_fields if field.get("key") and field["key"] not in PERSON_COLUMN_KEYS
        ],
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
    payload = _account_details(target)
    payload["_edit"] = create_edit_grant(actor, target, payload)
    encrypted = encrypt_account_details(payload, key, username=username)
    # Record the access, never the decrypted dossier, public key or ciphertext.
    record_audit(
        actor=actor, action="account.details_viewed", summary="Viewed account details",
        target_type="account", target_id=target.pk,
    )
    response = JsonResponse(encrypted)
    response["Referrer-Policy"] = "no-referrer"
    return response


@csrf_exempt
@never_cache
def admin_account_details_edit_view(request, username):
    actor, error = _require_role(request, Account.ROLE_ADMIN)
    if error:
        return error
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    # Allow base64 expansion of the 128 KiB plaintext plus the opaque grant.
    if len(request.body) > 184320:
        return JsonResponse({"error": "invalid_encrypted_request"}, status=400)
    data = _json_body(request)
    if not isinstance(data, dict):
        return JsonResponse({"error": "invalid_json"}, status=400)
    try:
        target = Account.objects.get(username__iexact=username)
    except Account.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)
    try:
        changes, expected_revision = decrypt_edit_request(actor, target, data)
        update_admin_account(target.pk, changes, actor=actor, expected_revision=expected_revision)
    except EditEncryptionError as exc:
        return JsonResponse({"error": exc.code}, status=exc.status)
    except AccountUpdateError as exc:
        payload = {"error": exc.code}
        if exc.field:
            payload["field"] = exc.field
        return JsonResponse(payload, status=exc.status)
    except IntegrityError:
        return JsonResponse({"error": "conflict"}, status=409)
    return JsonResponse({"status": "updated"})
