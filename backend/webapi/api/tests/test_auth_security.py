import json
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from api.models import Account, SystemSetting
from api.services.auth_service import generate_session


class AuthSecurityTests(TestCase):
    def setUp(self):
        cache.clear()
        self.account = Account.objects.create(
            username="member",
            email="member@example.com",
            password_hash=make_password("correct-password"),
            role=Account.ROLE_PARTICIPANT,
        )

    @override_settings(AUTH_TOKEN_MAX_AGE_SECONDS=60)
    def test_expired_token_is_rejected(self):
        token = generate_session(self.account)
        Account.objects.filter(id=self.account.id).update(
            token_created_at=timezone.now() - timedelta(seconds=61),
        )

        response = self.client.get(
            "/api/auth/me",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "invalid_token")

    def test_token_in_query_string_is_rejected(self):
        token = generate_session(self.account)
        response = self.client.get(f"/api/auth/me?token={token}")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "missing_token")

    @override_settings(
        AUTH_LOGIN_RATE_LIMIT=2,
        AUTH_LOGIN_RATE_WINDOW_SECONDS=60,
    )
    def test_login_is_rate_limited_after_repeated_failures(self):
        for _ in range(2):
            response = self.client.post(
                "/api/auth/login",
                data=json.dumps({
                    "username": self.account.username,
                    "password": "wrong-password",
                }),
                content_type="application/json",
                REMOTE_ADDR="203.0.113.5",
            )
            self.assertEqual(response.status_code, 401)

        response = self.client.post(
            "/api/auth/login",
            data=json.dumps({
                "username": self.account.username,
                "password": "wrong-password",
            }),
            content_type="application/json",
            REMOTE_ADDR="203.0.113.5",
        )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"], "too_many_attempts")
        self.assertEqual(response.headers["Retry-After"], "60")

    @override_settings(AUTH_MIN_PASSWORD_LENGTH=8)
    def test_signup_rejects_short_password_on_backend(self):
        SystemSetting.objects.update_or_create(
            key="registration_open",
            defaults={"value": True},
        )
        response = self.client.post(
            "/api/auth/signup",
            data=json.dumps({
                "username": "new-member",
                "email": "new-member@example.com",
                "password": "123456",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "password_too_short")
