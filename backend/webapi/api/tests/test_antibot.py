"""Anti-bot hardening — Turnstile + honeypot/time-trap on public endpoints."""

import json
import os
from unittest import mock

import requests

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase, override_settings

from api.models import Account, SystemSetting
from api.services.antibot_service import set_antibot_enabled
from api.services.auth_service import generate_session

TURNSTILE_ENV = {
    "TURNSTILE_SITE_KEY": "site-key-test",
    "TURNSTILE_SECRET_KEY": "secret-key-test",
}

GOOD_SIGNALS = {"company": "", "elapsed_ms": 8000}


def _mock_siteverify(success=True):
    payload = mock.Mock()
    payload.json.return_value = {"success": success}
    return mock.patch(
        "api.services.antibot_service.requests.post",
        return_value=payload,
    )


class AntibotBase(TestCase):
    def setUp(self):
        cache.clear()
        SystemSetting.objects.update_or_create(
            key="registration_open",
            defaults={"value": True},
        )

    def _post(self, path, payload, **extra):
        return self.client.post(
            path,
            data=json.dumps(payload),
            content_type="application/json",
            **extra,
        )


@mock.patch.dict(os.environ, TURNSTILE_ENV)
class AntibotToggleTests(AntibotBase):
    def test_site_config_reports_antibot_disabled_by_default(self):
        response = self.client.get("/api/public/site-config")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["antibot"]["enabled"])
        self.assertEqual(response.json()["antibot"]["site_key"], "")

    def test_antibot_stays_off_without_env_keys(self):
        # Bật công tắc nhưng thiếu cặp key môi trường → hệ thống coi như tắt.
        # Class này patch sẵn key vào env, nên xoá hẳn cho đúng kịch bản.
        with mock.patch.dict(os.environ, {}, clear=True):
            set_antibot_enabled(True)
            response = self.client.get("/api/public/site-config")
        antibot = response.json()["antibot"]
        self.assertFalse(antibot["enabled"])
        self.assertEqual(antibot["site_key"], "")

    def test_admin_can_toggle_antibot(self):
        admin = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash=make_password("admin-password"),
            role=Account.ROLE_MASTER_ADMIN,
        )
        token = generate_session(admin)

        response = self.client.put(
            "/api/admin/site-config",
            data=json.dumps({"antibot_enabled": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 200)
        antibot = response.json()["antibot"]
        self.assertTrue(antibot["enabled"])
        self.assertEqual(antibot["site_key"], "site-key-test")
        self.assertTrue(antibot["turnstile_ready"])

        # Công tắc anti-bot không đụng vào registration_open.
        self.assertTrue(response.json()["registration_open"])

    def test_non_admin_cannot_toggle_antibot(self):
        member = Account.objects.create(
            username="member",
            email="member@example.com",
            password_hash=make_password("member-password"),
            role=Account.ROLE_PARTICIPANT,
        )
        token = generate_session(member)
        response = self.client.put(
            "/api/admin/site-config",
            data=json.dumps({"antibot_enabled": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 403)


class AntibotDisabledTests(AntibotBase):
    """Tắt chống bot → mọi luồng chạy như cũ, không đòi token hay tín hiệu form."""

    def test_signup_works_without_token_when_disabled(self):
        response = self._post("/api/auth/signup", {
            "username": "fresh",
            "email": "fresh@example.com",
            "password": "long-enough-password",
        })
        self.assertEqual(response.status_code, 201)
        self.assertIn("token", response.json())

    def test_login_works_without_token_when_disabled(self):
        Account.objects.create(
            username="member",
            email="member@example.com",
            password_hash=make_password("correct-password"),
            role=Account.ROLE_PARTICIPANT,
        )
        response = self._post("/api/auth/login", {
            "username": "member",
            "password": "correct-password",
        })
        self.assertEqual(response.status_code, 200)


# Env Turnstile phải được patch suốt từng test (không chỉ lúc bật công tắc),
# vì antibot_config() đọc key mỗi request.
@mock.patch.dict(os.environ, TURNSTILE_ENV)
class AntibotTurnstileTests(AntibotBase):
    def setUp(self):
        super().setUp()
        set_antibot_enabled(True)

    def test_signup_requires_turnstile_token_when_enabled(self):
        response = self._post("/api/auth/signup", {
            "username": "bot",
            "email": "bot@example.com",
            "password": "long-enough-password",
            **GOOD_SIGNALS,
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "turnstile_required")

    def test_signup_rejects_invalid_turnstile_token(self):
        with _mock_siteverify(success=False):
            response = self._post("/api/auth/signup", {
                "username": "bot",
                "email": "bot@example.com",
                "password": "long-enough-password",
                "turnstile_token": "bad-token",
                **GOOD_SIGNALS,
            })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "turnstile_invalid")

    def test_turnstile_unreachable_fails_closed(self):
        with mock.patch(
            "api.services.antibot_service.requests.post",
            side_effect=requests.RequestException("cloudflare unreachable"),
        ):
            response = self._post("/api/auth/signup", {
                "username": "bot",
                "email": "bot@example.com",
                "password": "long-enough-password",
                "turnstile_token": "any-token",
                **GOOD_SIGNALS,
            })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "turnstile_unreachable")

    def test_signup_accepts_valid_token_with_form_signals(self):
        with _mock_siteverify(success=True):
            response = self._post("/api/auth/signup", {
                "username": "human",
                "email": "human@example.com",
                "password": "long-enough-password",
                "turnstile_token": "good-token",
                **GOOD_SIGNALS,
            })
        self.assertEqual(response.status_code, 201)
        self.assertIn("token", response.json())

    def test_login_blocked_without_token_when_enabled(self):
        Account.objects.create(
            username="member",
            email="member@example.com",
            password_hash=make_password("correct-password"),
            role=Account.ROLE_PARTICIPANT,
        )
        response = self._post("/api/auth/login", {
            "username": "member",
            "password": "correct-password",
            **GOOD_SIGNALS,
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "turnstile_required")

    def test_register_endpoints_blocked_without_token_when_enabled(self):
        individual = self._post("/api/register/individual", {
            "mssv": "25000001",
            "full_name": "Bot",
            **GOOD_SIGNALS,
        })
        self.assertEqual(individual.status_code, 400)
        self.assertEqual(individual.json()["error"], "turnstile_required")

        team = self._post("/api/register/team", {
            "team_name": "Bot Team",
            **GOOD_SIGNALS,
        })
        self.assertEqual(team.status_code, 400)
        self.assertEqual(team.json()["error"], "turnstile_required")

        lookup = self._post("/api/register/lookup", {
            "mssv": "25000001",
            "email": "bot@example.com",
            **GOOD_SIGNALS,
        })
        self.assertEqual(lookup.status_code, 400)
        self.assertEqual(lookup.json()["error"], "turnstile_required")


@mock.patch.dict(os.environ, TURNSTILE_ENV)
class AntibotFormSignalTests(AntibotBase):
    def setUp(self):
        super().setUp()
        set_antibot_enabled(True)

    def _signup(self, **overrides):
        payload = {
            "username": "someone",
            "email": "someone@example.com",
            "password": "long-enough-password",
            "turnstile_token": "good-token",
            **GOOD_SIGNALS,
        }
        payload.update(overrides)
        with _mock_siteverify(success=True):
            return self._post("/api/auth/signup", payload)

    def test_filled_honeypot_is_rejected(self):
        response = self._signup(company="Buy cheap shoes here")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "bot_detected")

    def test_fast_submission_is_rejected(self):
        response = self._signup(elapsed_ms=800)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "too_fast")

    def test_missing_elapsed_is_rejected(self):
        response = self._signup(elapsed_ms=None)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "too_fast")


class AntibotRateLimitTests(AntibotBase):
    @override_settings(AUTH_GOOGLE_RATE_LIMIT=2, AUTH_GOOGLE_RATE_WINDOW_SECONDS=60)
    def test_google_login_is_rate_limited(self):
        # Hai request đầu bị từ chối vì lý do nghiệp vụ (thiếu/sai credential
        # hoặc chưa cấu hình Google) — điều quan trọng là chưa dính 429.
        for _ in range(2):
            response = self._post("/api/auth/google", {"credential": "x"})
            self.assertNotEqual(response.status_code, 429)

        response = self._post("/api/auth/google", {"credential": "x"})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"], "too_many_attempts")

    @override_settings(FRAME_DOWNLOAD_RATE_LIMIT=2, FRAME_DOWNLOAD_RATE_WINDOW_SECONDS=60)
    def test_frame_download_is_rate_limited(self):
        for _ in range(2):
            response = self._post("/api/public/frames/1/download", {})
            self.assertEqual(response.status_code, 404)  # frame chưa tồn tại

        response = self._post("/api/public/frames/1/download", {})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"], "too_many_attempts")
