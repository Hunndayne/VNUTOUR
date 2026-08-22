"""
Team payment service — VietQR config + payment info for a team.

Đội đóng phí theo đầu người; mã QR VietQR được sinh từ cấu hình ngân hàng lưu
trong SystemSetting (payment_config) cộng với một mã 6 số riêng cho từng đội
(Team.payment_code) để đối soát chuyển khoản.
"""

from __future__ import annotations

import logging
import random
import unicodedata
from urllib.parse import quote

from api.models import SystemSetting, TeamMembership

logger = logging.getLogger(__name__)

PAYMENT_CONFIG_KEY = "payment_config"

DEFAULT_PAYMENT_CONFIG = {
    "bank_bin": "970436",
    "bank_short_name": "Vietcombank",
    "account_no": "",
    "account_name": "",
    "fee_per_person": 25000,
    "prefix": "VNUTOUR2026",
    "template": "compact2",
}


def get_payment_config() -> dict:
    """Return the payment config, defaults filling in any missing keys."""
    setting = SystemSetting.objects.filter(key=PAYMENT_CONFIG_KEY).first()
    value = setting.value if setting and isinstance(setting.value, dict) else {}
    merged = dict(DEFAULT_PAYMENT_CONFIG)
    merged.update({k: v for k, v in value.items() if k in DEFAULT_PAYMENT_CONFIG})
    return merged


def save_payment_config(data: dict) -> dict:
    """Validate/coerce incoming config, persist merged over defaults, return it."""
    data = data or {}
    merged = dict(DEFAULT_PAYMENT_CONFIG)
    merged.update(get_payment_config())

    for key in ("bank_bin", "bank_short_name", "account_no", "account_name", "prefix", "template"):
        if key in data and data[key] is not None:
            merged[key] = str(data[key]).strip()

    if "fee_per_person" in data and data["fee_per_person"] is not None:
        try:
            fee = int(data["fee_per_person"])
        except (TypeError, ValueError):
            raise ValueError("invalid_fee_per_person")
        if fee < 0:
            raise ValueError("invalid_fee_per_person")
        merged["fee_per_person"] = fee

    SystemSetting.objects.update_or_create(
        key=PAYMENT_CONFIG_KEY,
        defaults={"value": merged},
    )
    return merged


def strip_accents_upper(s: str) -> str:
    """Strip Vietnamese diacritics, map đ/Đ, uppercase, collapse whitespace."""
    if not s:
        return ""
    s = s.replace("đ", "d").replace("Đ", "D")
    normalized = unicodedata.normalize("NFD", s)
    without_marks = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return " ".join(without_marks.upper().split())


def ensure_payment_code(team) -> str:
    """Assign a random 6-digit payment_code to the team if it doesn't have one yet."""
    if team.payment_code:
        return team.payment_code
    code = f"{random.randint(100000, 999999)}"
    team.payment_code = code
    team.save(update_fields=["payment_code"])
    return code


def build_qr_image_url(config: dict, amount: int, content: str) -> str:
    """Build a VietQR image URL for the given config/amount/memo content."""
    bank_bin = config.get("bank_bin") or DEFAULT_PAYMENT_CONFIG["bank_bin"]
    account_no = config.get("account_no") or ""
    template = config.get("template") or "compact2"
    account_name = strip_accents_upper(config.get("account_name") or "")
    return (
        f"https://img.vietqr.io/image/{bank_bin}-{account_no}-{template}.png"
        f"?amount={amount}&addInfo={quote(content)}&accountName={quote(account_name)}"
    )


def build_payment_info(team) -> dict:
    """Return the VietQR payment payload (amount, memo, QR image URL) for a team."""
    config = get_payment_config()
    code = ensure_payment_code(team)

    memberships = list(TeamMembership.objects.filter(team=team).select_related("participant"))
    member_count = len(memberships)

    captain_membership = next((m for m in memberships if m.is_captain), None)
    if captain_membership is None:
        captain_membership = memberships[0] if memberships else None

    if captain_membership is not None:
        captain_mssv = captain_membership.participant.mssv or ""
        captain_name = captain_membership.participant.full_name or ""
    else:
        captain_mssv = ""
        captain_name = ""

    fee = int(config["fee_per_person"])
    amount = fee * max(member_count, 1)
    content = f'{config["prefix"]} {code} - {captain_mssv} - {strip_accents_upper(captain_name)}'
    # File-only: `has_proof` decides whether the dashboard shows the receipt and
    # lets the team move on to submit, so it must match the submit gate (which
    # requires an uploaded file, not the legacy pasted link).
    has_proof = bool(team.payment_proof_file)

    return {
        "amount": amount,
        "content": content,
        "payment_code": code,
        "member_count": member_count,
        "fee_per_person": fee,
        "bank": {
            "bin": config["bank_bin"],
            "short_name": config["bank_short_name"],
            "account_no": config["account_no"],
            "account_name": config["account_name"],
        },
        "qr_image_url": build_qr_image_url(config, amount, content),
        "has_proof": has_proof,
    }
