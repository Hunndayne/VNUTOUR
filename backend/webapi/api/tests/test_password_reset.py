import hashlib
import json
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from api.models import Account, EmailQueueItem, PasswordResetToken
from api.services.auth_service import create_password_reset_token


class ForgotPasswordApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.account = Account.objects.create(
            username="member",
            email="member@example.com",
            password_hash=make_password("old-password"),
            role=Account.ROLE_PARTICIPANT,
        )

    def _forgot(self, email):
        return self.client.post(
            "/api/auth/forgot-password",
            data=json.dumps({"email": email}),
            content_type="application/json",
        )

    def test_unknown_email_still_returns_generic_ok(self):
        response = self._forgot("nobody@example.com")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
        self.assertEqual(EmailQueueItem.objects.count(), 0)

    def test_known_email_returns_same_generic_ok_and_queues_email(self):
        response = self._forgot(self.account.email)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

        item = EmailQueueItem.objects.order_by("-id").first()
        self.assertIsNotNone(item, "a reset email should have been queued")
        self.assertEqual(item.to_emails, [self.account.email])
        self.assertIn("reset-password?token=", item.html_body)

        self.assertEqual(PasswordResetToken.objects.filter(account=self.account).count(), 1)

    def test_google_account_gets_generic_ok_but_no_email(self):
        self.account.google_sub = "google-sub-123"
        self.account.save(update_fields=["google_sub"])

        response = self._forgot(self.account.email)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
        self.assertEqual(EmailQueueItem.objects.count(), 0)
        self.assertEqual(PasswordResetToken.objects.filter(account=self.account).count(), 0)

    def test_requesting_again_invalidates_the_previous_token(self):
        self._forgot(self.account.email)
        first_token = PasswordResetToken.objects.get(account=self.account, used_at__isnull=True)

        self._forgot(self.account.email)

        first_token.refresh_from_db()
        self.assertIsNotNone(first_token.used_at)
        self.assertEqual(
            PasswordResetToken.objects.filter(account=self.account, used_at__isnull=True).count(),
            1,
        )

    def test_wrong_method_is_rejected(self):
        response = self.client.get("/api/auth/forgot-password")
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.json()["error"], "method_not_allowed")


class ResetPasswordApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.account = Account.objects.create(
            username="member",
            email="member@example.com",
            password_hash=make_password("old-password"),
            role=Account.ROLE_PARTICIPANT,
        )

    def _reset(self, token, new_password):
        return self.client.post(
            "/api/auth/reset-password",
            data=json.dumps({"token": token, "new_password": new_password}),
            content_type="application/json",
        )

    def test_valid_token_changes_password_and_is_single_use(self):
        raw_token = create_password_reset_token(self.account)

        response = self._reset(raw_token, "brand-new-password")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "password_changed"})

        self.account.refresh_from_db()
        self.assertTrue(check_password("brand-new-password", self.account.password_hash))

        # The same token cannot be replayed.
        second = self._reset(raw_token, "another-password")
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json()["error"], "invalid_or_expired_token")

    def test_expired_token_is_rejected(self):
        raw_token = create_password_reset_token(self.account)
        PasswordResetToken.objects.filter(account=self.account).update(
            expires_at=timezone.now() - timedelta(seconds=1),
        )

        response = self._reset(raw_token, "brand-new-password")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_or_expired_token")
        self.account.refresh_from_db()
        self.assertTrue(check_password("old-password", self.account.password_hash))

    def test_unknown_token_is_rejected(self):
        bogus = hashlib.sha256(b"never-issued").hexdigest()
        response = self._reset(bogus, "brand-new-password")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_or_expired_token")

    def test_google_account_token_is_rejected(self):
        # Not reachable via forgot-password (which never mails a Google
        # account a token), but guard the endpoint directly in case a token
        # was issued before the account linked Google.
        raw_token = create_password_reset_token(self.account)
        self.account.google_sub = "google-sub-123"
        self.account.save(update_fields=["google_sub"])

        response = self._reset(raw_token, "brand-new-password")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_or_expired_token")

    def test_password_too_short_is_rejected(self):
        raw_token = create_password_reset_token(self.account)

        response = self._reset(raw_token, "short")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "password_too_short")
        # The token is still unused since the request never applied.
        self.assertTrue(
            PasswordResetToken.objects.get(account=self.account).used_at is None,
        )

    def test_missing_fields_is_rejected(self):
        response = self._reset("", "brand-new-password")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "missing_fields")

    def test_wrong_method_is_rejected(self):
        response = self.client.get("/api/auth/reset-password")
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.json()["error"], "method_not_allowed")
