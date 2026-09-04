"""Site-config endpoints — public `allow_signup` flag + admin site-config /
registration-schema editors.

Covers:
  - GET /api/public/site-config reflects the `registration_open` switch
  - GET/PUT /api/admin/site-config toggles it (admin only)
  - GET/PUT /api/admin/registration-schema round-trips (admin only)
"""

import json

from django.test import TestCase

from api.models import Account, SystemSetting, Participant
from api.services.auth_service import generate_session
from api.services.team_service import (
    registration_is_open, set_registration_open,
    get_max_registrations, set_max_registrations,
)


class PublicSiteConfigViewTests(TestCase):
    def test_get_reflects_registration_open_true(self):
        set_registration_open(True)

        response = self.client.get("/api/public/site-config")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["allow_signup"], True)
        self.assertIn("antibot", response.json())

    def test_get_reflects_registration_open_false(self):
        set_registration_open(False)

        response = self.client.get("/api/public/site-config")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["allow_signup"], False)
        self.assertIn("antibot", response.json())

    def test_get_reflects_registration_full(self):
        set_max_registrations(2)
        Participant.objects.create(mssv="SV901", full_name="One")
        response = self.client.get("/api/public/site-config")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["registration_full"])

        Participant.objects.create(mssv="SV902", full_name="Two")
        response2 = self.client.get("/api/public/site-config")
        self.assertEqual(response2.status_code, 200)
        self.assertTrue(response2.json()["registration_full"])

    def test_non_get_is_method_not_allowed(self):
        response = self.client.post("/api/public/site-config")

        self.assertEqual(response.status_code, 405)


class AdminSiteConfigViewTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin1", email="admin1@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.admin_token = generate_session(self.admin)
        self.non_admin = Account.objects.create(
            username="participant1", email="participant1@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV001",
        )
        self.non_admin_token = generate_session(self.non_admin)

    def test_admin_get_returns_current_value(self):
        set_registration_open(True)

        response = self.client.get(
            "/api/admin/site-config",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["registration_open"], True)
        self.assertIn("antibot", response.json())

    def test_admin_put_toggles_value(self):
        set_registration_open(False)

        put_response = self.client.put(
            "/api/admin/site-config",
            data=json.dumps({"registration_open": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(put_response.status_code, 200)
        self.assertEqual(put_response.json()["registration_open"], True)
        self.assertTrue(registration_is_open())

        # And the public flag now reflects it.
        public = self.client.get("/api/public/site-config")
        self.assertEqual(public.json()["allow_signup"], True)

    def test_admin_put_parses_string_values_tolerantly(self):
        put_response = self.client.put(
            "/api/admin/site-config",
            data=json.dumps({"registration_open": "yes"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(put_response.status_code, 200)
        self.assertTrue(put_response.json()["registration_open"])

    def test_admin_put_sets_max_registrations(self):
        put_response = self.client.put(
            "/api/admin/site-config",
            data=json.dumps({"max_registrations": 150}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(put_response.status_code, 200)
        self.assertEqual(put_response.json()["max_registrations"], 150)
        self.assertEqual(get_max_registrations(), 150)

        # GET also returns max_registrations and current_registrations
        get_response = self.client.get(
            "/api/admin/site-config",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.json()["max_registrations"], 150)
        self.assertIn("current_registrations", get_response.json())

    def test_non_admin_is_forbidden(self):
        response = self.client.get(
            "/api/admin/site-config",
            HTTP_AUTHORIZATION=f"Bearer {self.non_admin_token}",
        )

        self.assertEqual(response.status_code, 403)

    def test_anonymous_is_unauthorized(self):
        response = self.client.get("/api/admin/site-config")

        self.assertEqual(response.status_code, 401)


class AdminRegistrationSchemaViewTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin1", email="admin1@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.admin_token = generate_session(self.admin)
        self.non_admin = Account.objects.create(
            username="participant1", email="participant1@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV001",
        )
        self.non_admin_token = generate_session(self.non_admin)

    def test_admin_get_returns_a_schema_dict(self):
        response = self.client.get(
            "/api/admin/registration-schema",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json().get("person_fields"), list)

    def test_admin_put_round_trips_a_schema(self):
        schema = {
            "version": 99,
            "modes": ["individual"],
            "person_fields": [
                {"key": "full_name", "label": "Họ tên", "type": "text",
                 "required": True, "enabled": True},
            ],
        }

        put_response = self.client.put(
            "/api/admin/registration-schema",
            data=json.dumps({"schema": schema}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(put_response.status_code, 200)
        self.assertEqual(put_response.json()["version"], 99)
        self.assertTrue(
            SystemSetting.objects.filter(key="registration_form_schema").exists()
        )

        get_response = self.client.get(
            "/api/admin/registration-schema",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(get_response.json()["version"], 99)

    def test_admin_put_rejects_non_dict_schema(self):
        response = self.client.put(
            "/api/admin/registration-schema",
            data=json.dumps({"schema": ["not", "a", "dict"]}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_schema")

    def test_admin_put_rejects_schema_missing_person_fields(self):
        response = self.client.put(
            "/api/admin/registration-schema",
            data=json.dumps({"schema": {"version": 1}}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_schema")

    def test_non_admin_is_forbidden(self):
        response = self.client.get(
            "/api/admin/registration-schema",
            HTTP_AUTHORIZATION=f"Bearer {self.non_admin_token}",
        )

        self.assertEqual(response.status_code, 403)
