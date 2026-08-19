"""
Anti-bot service — Cloudflare Turnstile + tín hiệu form (honeypot/time-trap).

Hai lớp cho các endpoint công khai:
- Turnstile (lớp chính): challenge của Cloudflare, xác thực server-side qua
  siteverify. Fail-closed — Cloudflare không trả lời thì từ chối; admin tắt
  nhanh bằng công tắc `antibot` ở trang Cài đặt hệ thống.
- Honeypot + time-trap (lớp phụ): trường ẩn mà bot hay tự điền, và form nộp
  quá nhanh ngay khi vừa mở.

Cả hai lớp chỉ kích hoạt khi SystemSetting `antibot.enabled` bật; Turnstile
thêm nữa cần đủ cặp key TURNSTILE_SITE_KEY/TURNSTILE_SECRET_KEY ở env.
"""

from __future__ import annotations

import os

import requests

from api.models import SystemSetting

ANTIBOT_KEY = "antibot"

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
SITEVERIFY_TIMEOUT_SECONDS = 5

# Form người thật cần ít nhất chừng đó giây để điền — nhanh hơn là bot hoặc
# script replay payload dựng sẵn.
HONEYPOT_FIELD = "company"
MIN_FORM_SECONDS = 3.0


def _turnstile_keys_ready() -> bool:
    return bool(os.getenv("TURNSTILE_SITE_KEY") and os.getenv("TURNSTILE_SECRET_KEY"))


def _antibot_setting() -> dict:
    setting = SystemSetting.objects.filter(key=ANTIBOT_KEY).first()
    value = setting.value if setting else None
    return value if isinstance(value, dict) else {}


def antibot_config() -> dict:
    """Trạng thái anti-bot tổng hợp cho admin + public site-config."""
    keys_ready = _turnstile_keys_ready()
    enabled = bool(_antibot_setting().get("enabled")) and keys_ready
    return {
        "enabled": enabled,
        # Frontend cần site key để render widget; secret không bao giờ rời server.
        "site_key": os.getenv("TURNSTILE_SITE_KEY", "") if enabled else "",
        # Báo cho admin biết vì sao không bật được: thiếu biến môi trường.
        "turnstile_ready": keys_ready,
    }


def set_antibot_enabled(value: bool) -> dict:
    SystemSetting.objects.update_or_create(
        key=ANTIBOT_KEY,
        defaults={"value": {"enabled": bool(value)}},
    )
    return antibot_config()


def verify_turnstile(token: str, remote_ip: str = "") -> tuple[bool, str]:
    """Xác minh một token Turnstile. Trả (ok, error_code)."""
    try:
        response = requests.post(
            SITEVERIFY_URL,
            data={
                "secret": os.getenv("TURNSTILE_SECRET_KEY", ""),
                "response": token,
                "remoteip": remote_ip,
            },
            timeout=SITEVERIFY_TIMEOUT_SECONDS,
        )
        payload = response.json()
    except (requests.RequestException, ValueError):
        # Fail-closed: không xác minh được coi như không qua.
        return False, "turnstile_unreachable"
    if not payload.get("success"):
        return False, "turnstile_invalid"
    return True, ""


def check_form_signals(payload: dict) -> str | None:
    """Honeypot + time-trap. Trả error_code hoặc None nếu qua."""
    if str(payload.get(HONEYPOT_FIELD) or "").strip():
        return "bot_detected"
    try:
        elapsed_ms = float(payload.get("elapsed_ms"))
    except (TypeError, ValueError):
        return "too_fast"
    if elapsed_ms < MIN_FORM_SECONDS * 1000:
        return "too_fast"
    return None
