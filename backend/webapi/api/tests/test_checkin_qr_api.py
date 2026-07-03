import json

from django.test import TestCase

from api.models import (
    Account, Participant, Team, TeamMembership,
    ProgramPhase, PhaseRoster,
)
from api.services.auth_service import generate_session


class CheckinQrApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin", email="admin@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.member_account = Account.objects.create(
            username="sv001", email="sv001@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV001",
        )
        self.participant = Participant.objects.create(
            account=self.member_account, mssv="SV001", full_name="Nguyen Van A",
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=1, is_current=True,
        )
        self.team = Team.objects.create(
            code="T0001", name="Team A", owner_account=self.member_account,
            approval_status=Team.APPROVAL_APPROVED, qr_token="oldtoken",
        )
        TeamMembership.objects.create(team=self.team, participant=self.participant, is_captain=True)
        PhaseRoster.objects.create(phase=self.phase, team=self.team, origin=PhaseRoster.ORIGIN_APPROVED)

    def _qr(self, account):
        token = generate_session(account)
        return self.client.get("/api/my-team/qr", HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_qr_hidden_when_disabled(self):
        resp = self._qr(self.member_account)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["enabled"])

    def test_enable_rotates_token_and_shows_qr(self):
        admin_token = generate_session(self.admin)
        toggle = self.client.post(
            "/api/admin/checkin-qr",
            data=json.dumps({"enabled": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )
        self.assertEqual(toggle.status_code, 200)
        self.assertTrue(toggle.json()["enabled"])
        self.assertEqual(toggle.json()["rotated_teams"], 1)

        self.team.refresh_from_db()
        self.assertNotEqual(self.team.qr_token, "oldtoken")

        resp = self._qr(self.member_account)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["enabled"])
        self.assertEqual(body["qr_payload"], f"t:{self.team.qr_token}")

    def test_qr_hidden_for_team_not_in_current_phase(self):
        # Đội chỉ ở roster qualifying; phase hiện tại chuyển sang final → không hiện QR.
        self.phase.is_current = False
        self.phase.save(update_fields=["is_current"])
        ProgramPhase.objects.create(key="final", label="Final", order=2, is_current=True)

        admin_token = generate_session(self.admin)
        self.client.post(
            "/api/admin/checkin-qr",
            data=json.dumps({"enabled": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )
        resp = self._qr(self.member_account)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["enabled"])

    def test_non_admin_cannot_toggle(self):
        token = generate_session(self.member_account)
        resp = self.client.post(
            "/api/admin/checkin-qr",
            data=json.dumps({"enabled": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertIn(resp.status_code, (401, 403))
