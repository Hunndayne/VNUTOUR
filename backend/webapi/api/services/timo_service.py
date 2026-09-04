"""
Đối soát thanh toán tự động qua hũ Timo của BTC (một hũ chung, không phải theo
đội — khác caulongdi, nơi mỗi nhóm có hũ riêng).

Cơ chế poll khi bấm nút — CỐ TÌNH không có cron/quét định kỳ, để tránh gọi API
Timo (không chính thức) quá nhiều lần và bị chặn. Đội trưởng bấm "Đã chuyển
tiền" -> quét một lượt lịch sử giao dịch hũ -> khớp payment_code + số tiền của
CHÍNH đội đó. Không khớp thì trả về thông báo để bấm lại sau.

Tham khảo cơ chế đã chạy thật ở dự án caulongdi (worker/src/timoPot.ts,
worker/src/paymentConfirm.ts) rồi port sang Python/Django. Khác biệt chính:
  - Một hũ DUY NHẤT của BTC (không phải mỗi đội một hũ) -> cấu hình chung ở
    SystemSetting, không theo group/team.
  - Không cron -> không cần bảng seen_txn để tránh xử lý trùng giữa các lần
    quét; idempotency chỉ cần "set payment_confirmed_at nếu chưa set", vì mỗi
    đội có payment_code riêng nên một giao dịch không thể khớp nhầm đội khác.
"""

from __future__ import annotations

import hashlib
import logging
import re
from urllib.parse import urlparse

import requests
from django.utils import timezone

from api.models import SystemSetting, Team

logger = logging.getLogger(__name__)

TIMO_API_BASE = "https://app2.timo.vn"
PAGE_SIZE = 20
MAX_PAGES = 5
FETCH_TIMEOUT_S = 10

TIMO_CONFIG_KEY = "timo_pot_config"

TIMO_CODE_SUCCESS = 200
TIMO_CODE_MONEY_POT_EXPIRED = 5505
TIMO_CODE_NOT_FOUND = 5515
TIMO_CODE_WRONG_PASSWORD = 5516
TIMO_CODE_LINK_EXPIRED = 5517
TIMO_CODE_PASSWORD_REQUIRED = 6002

_SHARE_CODE_RE = re.compile(r"/transaction/([A-Za-z0-9_-]+)")


def _timo_error_message(code: int) -> str:
    return {
        TIMO_CODE_WRONG_PASSWORD: "Mật mã bảo vệ của hũ không đúng",
        TIMO_CODE_PASSWORD_REQUIRED: "Hũ này yêu cầu mật mã bảo vệ — BTC cần cấu hình lại",
        TIMO_CODE_LINK_EXPIRED: "Link chia sẻ hũ đã hết hạn — BTC cần tạo link mới trong app Timo",
        TIMO_CODE_MONEY_POT_EXPIRED: "Hũ đã đóng hoặc hết hạn",
        TIMO_CODE_NOT_FOUND: "Không tìm thấy hũ — BTC cần kiểm tra lại link chia sẻ",
    }.get(code, f"Timo trả về mã lỗi {code}")


def _sha512_hex(value: str) -> str:
    return hashlib.sha512(value.encode("utf-8")).hexdigest()


def parse_share_code(value: str) -> str:
    """Accept either a bare code or a full https://share.timo.vn/... URL."""
    trimmed = (value or "").strip()
    match = _SHARE_CODE_RE.search(trimmed)
    if match:
        return match.group(1)
    # Fall back to treating it as a bare code, but guard against someone
    # pasting an unrelated URL by keeping only the path's last segment.
    if trimmed.startswith("http"):
        parsed = urlparse(trimmed)
        return (parsed.path.rstrip("/").rsplit("/", 1)[-1] or trimmed).strip()
    return trimmed


# ---------------------------------------------------------------------------
# Config: SystemSetting, one shared pot for the whole event. We hash the
# share code and the optional mật mã the moment they're saved and never
# persist (or return) the plaintext — the admin UI can overwrite but not
# read back the configured secret.
# ---------------------------------------------------------------------------

def get_timo_config() -> dict:
    setting = SystemSetting.objects.filter(key=TIMO_CONFIG_KEY).first()
    value = setting.value if setting and isinstance(setting.value, dict) else {}
    return {
        "hash_verify_code": value.get("hash_verify_code") or "",
        "security_code_hash": value.get("security_code_hash") or "",
    }


def is_timo_configured() -> bool:
    return bool(get_timo_config().get("hash_verify_code"))


def save_timo_config(share_code_or_url: str, password: str | None) -> dict:
    """Hash + persist the pot's share code / optional mật mã. Returns only
    whether it's configured — never the hash or plaintext, so the admin page
    has nothing sensitive to accidentally render back."""
    code = parse_share_code(share_code_or_url or "")
    if not code:
        raise ValueError("invalid_share_code")

    value = {
        "hash_verify_code": _sha512_hex(code),
        "security_code_hash": _sha512_hex(password.strip()) if (password or "").strip() else "",
    }
    SystemSetting.objects.update_or_create(
        key=TIMO_CONFIG_KEY, defaults={"value": value},
    )
    return {"configured": True}


def clear_timo_config() -> None:
    SystemSetting.objects.filter(key=TIMO_CONFIG_KEY).delete()


# ---------------------------------------------------------------------------
# API calls
# ---------------------------------------------------------------------------

def _post_timo(path: str, body: dict) -> dict:
    import json as _json

    resp = requests.post(
        f"{TIMO_API_BASE}{path}",
        data=_json.dumps(body),
        headers={
            "Content-Type": "application/json; charset=UTF-8",
            "Accept": "application/json, text/plain",
            "User-Agent": "",
        },
        timeout=FETCH_TIMEOUT_S,
    )
    resp.raise_for_status()
    return resp.json() or {}


def _fetch_txn_page(hash_verify_code: str, security_code_hash: str, xid_index: int) -> dict:
    body = {
        "size": PAGE_SIZE,
        "xidIndex": xid_index,
        "hashVerifyCode": hash_verify_code,
        "lang": "VN",
    }
    if security_code_hash:
        body["securityCode"] = security_code_hash
    return _post_timo("/moneypots/public/txn", body)


def _flatten_txn_page(page: dict) -> list[dict]:
    flat = []
    for group in page.get("txnHistories") or []:
        disp_date = group.get("dispDate")
        for item in group.get("item") or []:
            flat.append({**item, "dispDate": disp_date})
    return flat


class TimoConfirmResult:
    def __init__(self, status: str, message: str):
        self.status = status  # "confirmed" | "not_found" | "not_configured" | "error"
        self.message = message


def confirm_team_payment_via_timo(team: Team) -> TimoConfirmResult:
    """Poll the BTC's Timo pot ONCE (only ever called from the captain's
    "Đã chuyển tiền" button — no background/cron polling) and look for a
    transaction whose content contains this team's payment_code and whose
    amount matches what's owed. On a match, sets `payment_confirmed_at`.
    """
    if team.payment_confirmed_at:
        return TimoConfirmResult("confirmed", "Đội đã được xác nhận thanh toán trước đó.")

    config = get_timo_config()
    if not config.get("hash_verify_code"):
        return TimoConfirmResult(
            "not_configured",
            "BTC chưa cấu hình hũ Timo tự động — vui lòng dùng upload minh chứng thủ công.",
        )

    from api.services.payment_service import build_payment_info

    info = build_payment_info(team)
    expected_amount = int(info["amount"])
    payment_code = str(team.payment_code or info.get("payment_code") or "")
    if not payment_code:
        return TimoConfirmResult("error", "Đội chưa có mã thanh toán — thử tải lại trang.")

    xid_index = 0
    try:
        for _page_num in range(MAX_PAGES):
            page = _fetch_txn_page(
                config["hash_verify_code"], config["security_code_hash"], xid_index,
            )
            code = page.get("code", TIMO_CODE_SUCCESS)
            if code and code != TIMO_CODE_SUCCESS:
                return TimoConfirmResult("error", _timo_error_message(code))

            data = page.get("data") or page
            for txn in _flatten_txn_page(data):
                amount = txn.get("txnAmount")
                desc = txn.get("txnDesc") or ""
                if amount is None or amount <= 0:
                    continue
                if payment_code not in desc:
                    continue
                if int(amount) != expected_amount:
                    continue
                team.payment_confirmed_at = timezone.now()
                team.save(update_fields=["payment_confirmed_at", "updated_at"])
                return TimoConfirmResult(
                    "confirmed",
                    f"Đã tìm thấy giao dịch {amount:,}đ khớp mã {payment_code} — xác nhận thanh toán thành công.".replace(",", "."),
                )

            last_index = data.get("lastIndex")
            if last_index is None or last_index == -1:
                break
            xid_index = last_index
    except requests.Timeout:
        return TimoConfirmResult("error", "Kết nối tới Timo quá thời gian chờ — thử bấm lại sau.")
    except requests.RequestException as exc:
        logger.warning("Timo poll failed: %s", exc)
        return TimoConfirmResult("error", "Không kết nối được tới Timo — thử bấm lại sau.")

    return TimoConfirmResult(
        "not_found",
        "Chưa thấy giao dịch khớp mã và số tiền của đội — nếu vừa chuyển, đợi một chút rồi bấm lại.",
    )
