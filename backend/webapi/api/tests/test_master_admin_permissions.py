"""The admin / master-admin split.

A master admin is an admin plus sole authority over the shape of the programme:
the current phase, the phase calendar, sub-events and stations. These tests pin
down both halves — that plain admins keep everything else, and that the routes
around the split (granting the role, editing a master account) stay shut.
"""

import json

from django.test import TestCase

from api.models import Account, ProgramPhase, Station, SubEvent
from api.services.auth_service import generate_session


class MasterAdminPermissionTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="ops-admin",
            email="ops@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.master = Account.objects.create(
            username="boss",
            email="boss@example.com",
            password_hash="x",
            role=Account.ROLE_MASTER_ADMIN,
        )
        self.collab = Account.objects.create(
            username="helper",
            email="helper@example.com",
            password_hash="x",
            role=Account.ROLE_COLLAB,
        )
        self.admin_token = generate_session(self.admin)
        self.master_token = generate_session(self.master)
        self.collab_token = generate_session(self.collab)

        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=1, is_current=True,
        )
        self.event = SubEvent.objects.create(phase=self.phase, name="Chay tram")
        self.station = Station.objects.create(
            sub_event=self.event, code="S01", name="Tram 1",
        )

    def _auth(self, token):
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    # --- stations ---------------------------------------------------------

    def _create_station_as(self, token, code):
        return self.client.post(
            f"/api/sub-events/{self.event.id}/stations",
            data=json.dumps({"code": code, "name": f"Tram {code}"}),
            content_type="application/json",
            **self._auth(token),
        )

    def test_master_admin_creates_stations(self):
        response = self._create_station_as(self.master_token, "S02")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(Station.objects.filter(code="S02").exists())

    def test_plain_admin_cannot_create_stations(self):
        response = self._create_station_as(self.admin_token, "S03")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "master_admin_required")
        self.assertFalse(Station.objects.filter(code="S03").exists())

    def test_plain_admin_cannot_edit_a_station(self):
        response = self.client.patch(
            f"/api/stations/{self.station.id}",
            data=json.dumps({"name": "Doi ten"}),
            content_type="application/json",
            **self._auth(self.admin_token),
        )

        self.assertEqual(response.status_code, 403)
        self.station.refresh_from_db()
        self.assertEqual(self.station.name, "Tram 1")

    def test_plain_admin_cannot_delete_a_station(self):
        response = self.client.delete(
            f"/api/stations/{self.station.id}",
            **self._auth(self.admin_token),
        )

        self.assertEqual(response.status_code, 403)
        self.station.refresh_from_db()
        self.assertTrue(self.station.active)

    # --- what plain admins keep ------------------------------------------

    def test_plain_admin_still_reads_the_programme(self):
        response = self.client.get("/api/program", **self._auth(self.admin_token))

        self.assertEqual(response.status_code, 200)

    def test_plain_admin_still_manages_accounts(self):
        response = self.client.get("/api/admin/accounts", **self._auth(self.admin_token))

        self.assertEqual(response.status_code, 200)

    def test_master_admin_reaches_ordinary_admin_screens(self):
        """The role is a superset, so every plain-admin gate admits it too."""
        response = self.client.get("/api/admin/accounts", **self._auth(self.master_token))

        self.assertEqual(response.status_code, 200)

    def test_collab_is_unaffected_by_the_split(self):
        response = self.client.get("/api/program", **self._auth(self.collab_token))
        self.assertEqual(response.status_code, 200)

        blocked = self._create_station_as(self.collab_token, "S04")
        self.assertEqual(blocked.status_code, 403)

    # --- no self-promotion ------------------------------------------------

    def test_plain_admin_cannot_grant_the_master_role(self):
        response = self.client.patch(
            f"/api/admin/accounts/{self.admin.username}",
            data=json.dumps({"role": Account.ROLE_MASTER_ADMIN}),
            content_type="application/json",
            **self._auth(self.admin_token),
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "master_admin_required")
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, Account.ROLE_ADMIN)

    def test_plain_admin_cannot_create_a_master_account(self):
        response = self.client.post(
            "/api/admin/accounts",
            data=json.dumps({
                "username": "sneaky", "email": "sneaky@example.com",
                "password": "hunter2hunter2", "role": Account.ROLE_MASTER_ADMIN,
            }),
            content_type="application/json",
            **self._auth(self.admin_token),
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(Account.objects.filter(username="sneaky").exists())

    def test_plain_admin_cannot_reset_a_master_password(self):
        """Taking over the account would be the same as being granted the role."""
        response = self.client.patch(
            f"/api/admin/accounts/{self.master.username}",
            data=json.dumps({"password": "takeover12345"}),
            content_type="application/json",
            **self._auth(self.admin_token),
        )

        self.assertEqual(response.status_code, 403)
        self.master.refresh_from_db()
        self.assertEqual(self.master.password_hash, "x")

    def test_plain_admin_cannot_deactivate_a_master(self):
        response = self.client.delete(
            f"/api/admin/accounts/{self.master.username}",
            **self._auth(self.admin_token),
        )

        self.assertEqual(response.status_code, 403)
        self.master.refresh_from_db()
        self.assertTrue(self.master.is_active)

    def test_plain_admin_still_manages_ordinary_roles(self):
        response = self.client.patch(
            f"/api/admin/accounts/{self.collab.username}",
            data=json.dumps({"role": Account.ROLE_ADMIN}),
            content_type="application/json",
            **self._auth(self.admin_token),
        )

        self.assertEqual(response.status_code, 200)
        self.collab.refresh_from_db()
        self.assertEqual(self.collab.role, Account.ROLE_ADMIN)

    def test_master_admin_grants_the_master_role(self):
        response = self.client.patch(
            f"/api/admin/accounts/{self.admin.username}",
            data=json.dumps({"role": Account.ROLE_MASTER_ADMIN}),
            content_type="application/json",
            **self._auth(self.master_token),
        )

        self.assertEqual(response.status_code, 200)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, Account.ROLE_MASTER_ADMIN)
