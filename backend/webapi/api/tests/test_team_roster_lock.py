"""The payment-confirm roster lock on /api/my-team.

Confirming the team for payment locks its roster: the transfer amount is
fee x member count, so any member/name change after the confirm dialog would
leave the paid sum and the expected sum disagreeing. Covered here:
  - PATCH {roster_locked: true} locks, and only on a roster the submit gate
    would accept (complete members, size in range) — a locked roster must be
    submittable as-is, never a dead end
  - add/edit/remove member and rename are refused while locked
  - GET /api/my-team reports the flag the dashboard locks its steps on
  - rejecting the team (BTC asking for changes) unlocks it again
"""

from datetime import date
import json

from django.test import TestCase

from api.models import Account, Participant, ProgramPhase, SystemSetting, Team, TeamMembership
from api.services.auth_service import generate_session
from api.services.team_service import reject_team


def participant_kwargs(mssv):
    return dict(
        mssv=mssv,
        full_name=f"Thành Viên {mssv}",
        email=f"{mssv.lower()}@example.com",
        phone="0900000000",
        school="HCMUT",
        faculty="KHMT",
        facebook="https://facebook.com/sv",
        cccd="012345678901",
        date_of_birth=date(2006, 1, 1),
        extra={"gender": "male"},
    )


class RosterLockTestBase(TestCase):
    def setUp(self):
        ProgramPhase.objects.create(
            key="registration",
            label="Registration",
            order=1,
            is_current=True,
        )
        SystemSetting.objects.create(key="registration_open", value=True)
        self.account = Account.objects.create(
            username="captain",
            email="captain@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV001",
        )
        self.captain = Participant.objects.create(account=self.account, **participant_kwargs("SV001"))
        self.team = Team.objects.create(
            code="T0001", name="Pending team SV001", owner_account=self.account,
        )
        TeamMembership.objects.create(team=self.team, participant=self.captain, is_captain=True)
        self.token = generate_session(self.account)

    def _add_member(self, mssv, **overrides):
        kwargs = participant_kwargs(mssv)
        kwargs.update(overrides)
        participant = Participant.objects.create(**kwargs)
        TeamMembership.objects.create(team=self.team, participant=participant, is_captain=False)
        return participant

    def _auth(self, token=None):
        return {"HTTP_AUTHORIZATION": f"Bearer {token or self.token}"}

    def _patch(self, body):
        return self.client.patch(
            "/api/my-team",
            data=json.dumps(body),
            content_type="application/json",
            **self._auth(),
        )


class RosterLockTests(RosterLockTestBase):
    def test_confirm_locks_roster_and_reports_the_flag(self):
        self._add_member("SV002")

        response = self._patch({"team_name": "Đội Cửu Long", "roster_locked": True})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["name"], "Đội Cửu Long")
        self.assertTrue(payload["roster_locked"])
        self.team.refresh_from_db()
        self.assertIsNotNone(self.team.roster_locked_at)

        overview = self.client.get("/api/my-team", **self._auth()).json()
        self.assertTrue(overview["team"]["roster_locked"])

    def test_lock_is_idempotent_and_keeps_the_unchanged_name_writable(self):
        self._add_member("SV002")
        self._patch({"team_name": "Đội A", "roster_locked": True})

        # Re-confirming (dialog reopened, page reloaded) and resending the
        # same name must stay fine — only a *changing* name is refused.
        response = self._patch({"team_name": "Đội A", "roster_locked": True})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["roster_locked"])

    def test_lock_refuses_an_incomplete_member(self):
        self._add_member("SV002", facebook="")

        response = self._patch({"roster_locked": True})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "missing:member_2:facebook")
        self.team.refresh_from_db()
        self.assertIsNone(self.team.roster_locked_at)

    def test_lock_refuses_an_out_of_range_roster(self):
        for index in range(2, 7):
            self._add_member(f"SV{index:03d}")

        response = self._patch({"roster_locked": True})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "team_size_out_of_range:1-5")
        self.team.refresh_from_db()
        self.assertIsNone(self.team.roster_locked_at)

    def test_locked_roster_refuses_member_and_name_changes(self):
        self._add_member("SV002")
        self._patch({"team_name": "Đội A", "roster_locked": True})

        added = self.client.post(
            "/api/my-team/members",
            data=json.dumps({"mssv": "SV900", "email": "sv900@example.com"}),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(added.status_code, 409)
        self.assertEqual(added.json()["error"], "roster_locked")

        edited = self.client.patch(
            "/api/my-team/members/SV002",
            data=json.dumps({"full_name": "Tên Khác"}),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(edited.status_code, 409)
        self.assertEqual(edited.json()["error"], "roster_locked")

        removed = self.client.delete("/api/my-team/members/SV002", **self._auth())
        self.assertEqual(removed.status_code, 409)
        self.assertEqual(removed.json()["error"], "roster_locked")

        renamed = self._patch({"team_name": "Tên Hoàn Toàn Khác"})
        self.assertEqual(renamed.status_code, 409)
        self.assertEqual(renamed.json()["error"], "roster_locked")

    def test_rejection_unlocks_the_roster(self):
        self._add_member("SV002")
        self._patch({"roster_locked": True})

        reviewer = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash="x",
            role=Account.ROLE_MASTER_ADMIN,
        )
        reject_team(self.team, reviewer, "Ảnh chuyển khoản không rõ")

        self.team.refresh_from_db()
        self.assertIsNone(self.team.roster_locked_at)
        removed = self.client.delete("/api/my-team/members/SV002", **self._auth())
        self.assertEqual(removed.status_code, 200)
