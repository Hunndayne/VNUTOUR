from __future__ import annotations

import json
import re

from django.conf import settings
from django.http import HttpRequest, JsonResponse

from .models import Account, Participant
from .services.email_service import send_email, send_personalized_emails
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


def _render_template(template: str, context: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip().lower()
        return context.get(key, "")

    return PLACEHOLDER_PATTERN.sub(replace, template)


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

    external = body.get("external_emails", [])
    if isinstance(external, list):
        for em in external:
            email = str((em or "").strip()).lower()
            if not email:
                continue
            recipient_map.setdefault(email, {
                "email": email,
                "name": _display_name_for_external(email),
                "full_name": _display_name_for_external(email),
                "username": "",
                "role": "external",
            })

    to_list = sorted(recipient_map.keys())
    if not to_list:
        return JsonResponse({"error": "no_recipients"}, status=400)

    if not settings.EMAIL_HOST:
        return JsonResponse({"error": "smtp_not_configured"}, status=500)

    uses_placeholders = bool(PLACEHOLDER_PATTERN.search(subject) or PLACEHOLDER_PATTERN.search(html_body))
    if not uses_placeholders:
        sent = send_email(to_emails=to_list, subject=subject, html_body=html_body)
        return JsonResponse({
            "sent": sent,
            "recipients": to_list,
            "personalized": False,
        })

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
            "to_email": recipient["email"],
            "subject": _render_template(subject, context),
            "html_body": _render_template(html_body, context),
        })

    sent, sent_recipients = send_personalized_emails(messages=messages)
    return JsonResponse({
        "sent": sent,
        "recipients": sent_recipients,
        "personalized": True,
        "supported_placeholders": [
            "{{ten}}",
            "{{name}}",
            "{{full_name}}",
            "{{ho_ten}}",
            "{{email}}",
            "{{username}}",
            "{{role}}",
        ],
    })
