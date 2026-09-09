"""Admin edits preserve an existing person; registration owns first-time linking."""
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.db.models import Q

from api.models import Account, Participant
from api.services.audit_service import record_audit


class AccountUpdateError(Exception):
    def __init__(self, code, status=409):
        self.code = code
        self.status = status
        super().__init__(code)


@transaction.atomic
def update_admin_account(account_id, data, *, actor):
    account = Account.objects.select_for_update().get(pk=account_id)
    if account.role == Account.ROLE_MASTER_ADMIN and actor.role != Account.ROLE_MASTER_ADMIN:
        raise AccountUpdateError("master_admin_required", 403)

    updates = {}
    if data.get("email"):
        updates["email"] = str(data["email"]).strip().lower()
    if "mssv" in data:
        updates["mssv"] = str(data["mssv"] or "").strip().upper() or None
    if "full_name" in data or "fullName" in data:
        updates["full_name"] = str(data.get("full_name") or data.get("fullName") or "").strip() or None
    if data.get("role") in dict(Account.ROLE_CHOICES):
        if data["role"] == Account.ROLE_MASTER_ADMIN and actor.role != Account.ROLE_MASTER_ADMIN:
            raise AccountUpdateError("master_admin_required", 403)
        updates["role"] = data["role"]
    if "is_active" in data:
        updates["is_active"] = bool(data["is_active"])
    if data.get("password"):
        if len(str(data["password"])) < settings.AUTH_MIN_PASSWORD_LENGTH:
            raise AccountUpdateError("password_too_short", 400)
        updates["password_hash"] = make_password(data["password"])

    profile = Participant.objects.select_for_update().filter(account_id=account.pk).first()
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
    for field, value in updates.items():
        setattr(account, field, value)
    if updates:
        account.save(update_fields=[*updates, "updated_at"])
    if profile and identity_supplied:
        profile_updates = []
        for field in ("mssv", "email", "full_name"):
            if field in updates:
                setattr(profile, field, updates[field] or "")
                profile_updates.append(field)
        if profile_updates:
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
    return account
