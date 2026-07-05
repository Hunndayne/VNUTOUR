import json

from django.contrib.auth.hashers import make_password
from django.test import TestCase

from api.models import Account
from api.services.auth_service import generate_session


class AuthApiTests(TestCase):
    def test_change_password_wrong_current_password_is_bad_request(self):
        account = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash=make_password("correct-password"),
            role=Account.ROLE_ADMIN,
        )
        token = generate_session(account)

        response = self.client.put(
            "/api/auth/me/password",
            data=json.dumps({
                "current_password": "wrong-password",
                "new_password": "new-password",
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_current_password")
