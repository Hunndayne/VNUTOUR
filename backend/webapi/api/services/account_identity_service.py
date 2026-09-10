"""Admin edits preserve an existing person; registration owns first-time linking."""
import json
from datetime import date

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from api.models import Account, Participant
from api.services.audit_service import record_audit


class AccountUpdateError(Exception):
    def __init__(self, code, status=409, *, field=None):
        self.code = code
        self.status = status
        self.field = field
        super().__init__(code)


def _text_value(data, field, model):
    value = data[field]
    if value is not None and not isinstance(value, str):
        raise AccountUpdateError("invalid_field", 400, field=field)
    value = (value or "").strip()
    if len(value) > model._meta.get_field(field).max_length:
        raise AccountUpdateError("invalid_field", 400, field=field)
    return value


@transaction.atomic
def update_admin_account(account_id, data, *, actor, expected_revision=None):
    account = Account.objects.select_for_update().get(pk=account_id)
    if account.role == Account.ROLE_MASTER_ADMIN and actor.role != Account.ROLE_MASTER_ADMIN:
        raise AccountUpdateError("master_admin_required", 403)

    profile = Participant.objects.select_for_update().filter(account_id=account.pk).first()
    if expected_revision is not None:
        current_revision = {
            "account_updated_at": account.updated_at.isoformat(),
            "participant_id": profile.pk if profile else None,
            "participant_updated_at": profile.updated_at.isoformat() if profile else None,
        }
        if expected_revision != current_revision:
            raise AccountUpdateError("account_changed")

    updates = {}
    if "email" in data:
        email = _text_value(data, "email", Account).lower()
        try:
            validate_email(email)
        except ValidationError:
            raise AccountUpdateError("invalid_email", 400) from None
        updates["email"] = email
    if "mssv" in data:
        updates["mssv"] = _text_value(data, "mssv", Account).upper() or None
    if "full_name" in data or "fullName" in data:
        value = data.get("full_name", data.get("fullName"))
        updates["full_name"] = _text_value({"full_name": value}, "full_name", Account) or None
    for field in ("phone", "school", "faculty", "avatar"):
        if field in data:
            updates[field] = _text_value(data, field, Account) or None
    if "role" in data:
        if not isinstance(data["role"], str) or data["role"] not in dict(Account.ROLE_CHOICES):
            raise AccountUpdateError("invalid_field", 400, field="role")
        if data["role"] == Account.ROLE_MASTER_ADMIN and actor.role != Account.ROLE_MASTER_ADMIN:
            raise AccountUpdateError("master_admin_required", 403)
        updates["role"] = data["role"]
    if "is_active" in data:
        if not isinstance(data["is_active"], bool):
            raise AccountUpdateError("invalid_field", 400, field="is_active")
        updates["is_active"] = data["is_active"]
    if data.get("password"):
        if not isinstance(data["password"], str):
            raise AccountUpdateError("invalid_field", 400, field="password")
        if len(data["password"]) < settings.AUTH_MIN_PASSWORD_LENGTH:
            raise AccountUpdateError("password_too_short", 400)
        updates["password_hash"] = make_password(data["password"])

    profile_updates = {}
    profile_only = {"cccd", "facebook", "date_of_birth", "extra"} & data.keys()
    if profile_only and not profile:
        raise AccountUpdateError("profile_not_linked")
    for field in ("cccd", "facebook"):
        if field in data:
            profile_updates[field] = _text_value(data, field, Participant) or None
    if "date_of_birth" in data:
        value = data["date_of_birth"]
        if value in (None, ""):
            profile_updates["date_of_birth"] = None
        else:
            try:
                parsed = date.fromisoformat(value)
                if parsed.isoformat() != value or parsed > timezone.localdate():
                    raise ValueError
            except (TypeError, ValueError):
                raise AccountUpdateError("invalid_date_of_birth", 400) from None
            profile_updates["date_of_birth"] = parsed
    if "extra" in data:
        extra = data["extra"]
        if not isinstance(extra, dict):
            raise AccountUpdateError("invalid_profile_extra", 400)
        try:
            if len(json.dumps(extra, allow_nan=False).encode("utf-8")) > 16384:
                raise ValueError
        except (TypeError, ValueError):
            raise AccountUpdateError("invalid_profile_extra", 400) from None
        if profile.extra is not None and not isinstance(profile.extra, dict):
            raise AccountUpdateError("profile_extra_review_required")
        # PATCH only the supplied keys; preserve other registration answers.
        profile_updates["extra"] = {**(profile.extra or {}), **extra}
    new_mssv = updates.get("mssv", account.mssv)
    new_email = updates.get("email", account.email)
    # Report the conflicting field before a database constraint reduces it to
    # a generic IntegrityError. Keep the constraints for concurrent writes.
    other_accounts = Account.objects.exclude(pk=account.pk)
    if "email" in updates and other_accounts.filter(email__iexact=new_email).exists():
        raise AccountUpdateError("account_email_conflict")
    if "mssv" in updates and new_mssv and other_accounts.filter(mssv__iexact=new_mssv).exists():
        raise AccountUpdateError("account_mssv_conflict")
    identity_supplied = bool({"mssv", "email", "full_name"} & updates.keys())
    if identity_supplied:
        if profile:
            # Legacy inconsistencies require deliberate reconciliation, not a
            # guess based on the new text an admin happened to enter.
            if profile.mssv != account.mssv:
                raise AccountUpdateError("identity_review_required")
            if not new_mssv:
                raise AccountUpdateError("linked_profile_mssv_required")
            candidates = Participant.objects.exclude(pk=profile.pk)
            if candidates.filter(Q(mssv=new_mssv) | Q(email=new_email)).exists():
                raise AccountUpdateError("participant_identity_conflict")
        else:
            # Even an unclaimed/no-team row represents a person. Do not adopt,
            # merge, delete or leave an ambiguous old identity behind here.
            mssvs = [value for value in (account.mssv, new_mssv) if value]
            emails = [value for value in (account.email, new_email) if value]
            if Participant.objects.filter(Q(mssv__in=mssvs) | Q(email__in=emails)).exists():
                raise AccountUpdateError("identity_review_required")

    before = {"mssv": account.mssv, "email": account.email}
    changed_account_fields = [field for field, value in updates.items() if getattr(account, field) != value]
    if profile:
        for field in ("mssv", "email", "full_name", "phone", "school", "faculty"):
            if field in updates:
                profile_updates[field] = updates[field] or ""
    changed_profile_fields = [
        field for field, value in profile_updates.items() if getattr(profile, field) != value
    ]
    for field, value in updates.items():
        setattr(account, field, value)
    if updates:
        account.save(update_fields=[*updates, "updated_at"])
    if profile and profile_updates:
        for field, value in profile_updates.items():
            setattr(profile, field, value)
        profile.save(update_fields=[*profile_updates, "updated_at"])
    after = {"mssv": account.mssv, "email": account.email}
    if before != after:
        record_audit(
            actor=actor, action="account.identity_updated",
            summary="Updated account identity without changing profile or team ownership",
            target_type="account", target_id=account.pk,
            before_data=before, after_data=after,
            metadata={"participant_id": profile.pk if profile else None},
        )
    if changed_account_fields or changed_profile_fields:
        record_audit(
            actor=actor, action="account.details_updated",
            summary="Updated account and linked registration profile",
            target_type="account", target_id=account.pk,
            metadata={
                "participant_id": profile.pk if profile else None,
                "account_fields": ["password" if field == "password_hash" else field for field in changed_account_fields],
                "profile_fields": changed_profile_fields,
            },
        )
    return account
