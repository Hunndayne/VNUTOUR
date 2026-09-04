from __future__ import annotations

import json
import re
from html import escape

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .models import Account, Participant
from .services.email_service import enqueue_email_messages
from .services.audit_service import record_audit
from .views_shared import _require_role

PLACEHOLDER_PATTERN = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


def _display_name_for_external(email: str) -> str:
    local = (email or "").split("@")[0].strip()
    return local or email


def _participant_name_by_account_ids(accounts: list[Account]) -> dict[int, str]:
    account_ids = [account.id for account in accounts]
    if not account_ids:
        return {}
    return {
        int(item["account_id"]): str(item.get("full_name") or "").strip()
        for item in Participant.objects.filter(account_id__in=account_ids).values("account_id", "full_name")
        if item.get("account_id")
    }


def _render_template(template: str, context: dict[str, str], *, as_html: bool = False) -> str:
    """Fill {{...}} placeholders from a recipient's record.

    `as_html` escapes the substituted values, not the template — the sender's own
    markup must survive, but a recipient's name is data they typed and would
    otherwise become markup in everyone's inbox. The subject is plain text, so it
    is rendered without escaping; escaping there would show a literal `&amp;`.
    """
    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip().lower()
        value = context.get(key, "")
        return escape(value) if as_html else value

    return PLACEHOLDER_PATTERN.sub(replace, template)


def _email_list(value) -> list[str]:
    if isinstance(value, str):
        values = re.split(r"[\n,;]+", value)
    elif isinstance(value, list):
        values = value
    else:
        values = []

    result = []
    seen = set()
    for raw in values:
        email = str(raw or "").strip().lower()
        if not email or email in seen:
            continue
        try:
            validate_email(email)
        except ValidationError as exc:
            raise ValueError(f"invalid_email:{email}") from exc
        seen.add(email)
        result.append(email)
    return result


@csrf_exempt
def send_email_view(request: HttpRequest) -> JsonResponse:
    """POST /api/admin/send-email - send bulk or personalized email."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "invalid_json"}, status=400)

    subject = str((body.get("subject") or "").strip())
    html_body = str((body.get("html_body") or "").strip())
    if not subject:
        return JsonResponse({"error": "subject_required"}, status=400)
    if not html_body:
        return JsonResponse({"error": "html_body_required"}, status=400)

    recipient_type = body.get("recipient_type", "all")
    account_qs = Account.objects.none()
    if recipient_type == "all":
        account_qs = Account.objects.filter(is_active=True)
    elif recipient_type == "participant":
        account_qs = Account.objects.filter(role=Account.ROLE_PARTICIPANT, is_active=True)
    elif recipient_type == "collab":
        account_qs = Account.objects.filter(role=Account.ROLE_COLLAB, is_active=True)
    elif recipient_type == "admin":
        account_qs = Account.objects.filter(role=Account.ROLE_ADMIN, is_active=True)
    elif recipient_type == "specific":
        usernames = body.get("usernames", [])
        if usernames:
            account_qs = Account.objects.filter(username__in=usernames, is_active=True)

    accounts = list(account_qs.only("id", "username", "email", "full_name", "role"))
    participant_names = _participant_name_by_account_ids(accounts)

    recipient_map: dict[str, dict[str, str]] = {}
    for account in accounts:
        email = str(account.email or "").strip().lower()
        if not email:
            continue
        full_name = (
            str(participant_names.get(account.id) or "").strip()
            or str(account.full_name or "").strip()
            or str(account.username or "").strip()
            or _display_name_for_external(email)
        )
        recipient_map[email] = {
            "email": email,
            "name": full_name,
            "full_name": full_name,
            "username": str(account.username or "").strip(),
            "role": str(account.role or "").strip(),
        }

    try:
        direct_to = _email_list(body.get("to_emails", []))
        direct_to.extend(_email_list(body.get("external_emails", [])))
        cc_list = _email_list(body.get("cc_emails", []))
        bcc_list = _email_list(body.get("bcc_emails", []))
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    for email in direct_to:
        recipient_map.setdefault(email, {
            "email": email,
            "name": _display_name_for_external(email),
            "full_name": _display_name_for_external(email),
            "username": "",
            "role": "external",
        })

    to_list = list(recipient_map.keys())
    to_set = set(to_list)
    cc_list = [email for email in cc_list if email not in to_set]
    cc_set = set(cc_list)
    bcc_list = [
        email for email in bcc_list
        if email not in to_set and email not in cc_set
    ]

    if not (to_list or cc_list or bcc_list):
        return JsonResponse({"error": "no_recipients"}, status=400)

    if not settings.EMAIL_HOST:
        return JsonResponse({"error": "smtp_not_configured"}, status=500)

    uses_placeholders = bool(PLACEHOLDER_PATTERN.search(subject) or PLACEHOLDER_PATTERN.search(html_body))
    if not uses_placeholders:
        queued_items = enqueue_email_messages(
            messages=[{
                "to_emails": to_list,
                "cc_emails": cc_list,
                "bcc_emails": bcc_list,
                "subject": subject,
                "html_body": html_body,
            }],
            created_by=acc,
        )
        record_audit(
            actor=acc,
            action="email.enqueue",
            summary=f"Xếp hàng email tới {len(to_list) + len(cc_list) + len(bcc_list)} địa chỉ",
            target_type="EmailQueueItem",
            metadata={"queue_ids": [item.id for item in queued_items]},
            reversible=False,
        )
        return JsonResponse({
            "queued": len(queued_items),
            "queue_ids": [item.id for item in queued_items],
            "recipients": to_list + cc_list + bcc_list,
            "personalized": False,
        }, status=202)

    messages = []
    for recipient in recipient_map.values():
        context = {
            "ten": recipient["name"],
            "name": recipient["name"],
            "full_name": recipient["full_name"],
            "ho_ten": recipient["full_name"],
            "email": recipient["email"],
            "username": recipient["username"],
            "role": recipient["role"],
        }
        messages.append({
            "to_emails": [recipient["email"]],
            "cc_emails": cc_list,
            "bcc_emails": bcc_list,
            "subject": _render_template(subject, context),
            "html_body": _render_template(html_body, context, as_html=True),
        })

    if not messages:
        return JsonResponse(
            {"error": "personalization_requires_to_recipient"},
            status=400,
        )
    queued_items = enqueue_email_messages(messages=messages, created_by=acc)
    record_audit(
        actor=acc,
        action="email.enqueue_personalized",
        summary=f"Xếp hàng {len(queued_items)} email cá nhân hóa",
        target_type="EmailQueueItem",
        metadata={"queue_ids": [item.id for item in queued_items]},
        reversible=False,
    )
    return JsonResponse({
        "queued": len(queued_items),
        "queue_ids": [item.id for item in queued_items],
        "recipients": [item["to_emails"][0] for item in messages],
        "personalized": True,
        "interval_seconds": settings.EMAIL_QUEUE_INTERVAL_SECONDS,
        "supported_placeholders": [
            "{{ten}}",
            "{{name}}",
            "{{full_name}}",
            "{{ho_ten}}",
            "{{email}}",
            "{{username}}",
            "{{role}}",
        ],
    }, status=202)
