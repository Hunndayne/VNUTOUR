"""The payment-confirm roster lock on /api/my-team.

Confirming the team for payment locks its roster: the transfer amount is
fee x member count, so any member/name change after the confirm dialog would
leave the paid sum and the expected sum disagreeing. Covered here:
  - PATCH {roster_locked: true} locks, and only on a roster the submit gate
    would accept — a full team (size == max) or a solo entry (size == 1),
    with complete members — never a partial 2..max-1 roster
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

    def _fill_to_full(self, **last_member_overrides):
        # Bring the roster to the full 5 (captain + 4). Overrides apply to the
        # last added member so a test can make exactly one member incomplete.
        for index in range(2, 6):
            overrides = last_member_overrides if index == 5 else {}
            self._add_member(f"SV{index:03d}", **overrides)

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
    def test_confirm_locks_a_full_roster_and_reports_the_flag(self):
        self._fill_to_full()

        response = self._patch({"team_name": "Đội Cửu Long", "roster_locked": True})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["name"], "Đội Cửu Long")
        self.assertTrue(payload["roster_locked"])
        self.team.refresh_from_db()
        self.assertIsNotNone(self.team.roster_locked_at)

        overview = self.client.get("/api/my-team", **self._auth()).json()
        self.assertTrue(overview["team"]["roster_locked"])

    def test_solo_roster_locks_without_a_name(self):
        # A one-person (individual) registration is final on its own; it keeps
        # the server placeholder name, so the lock carries no team_name.
        response = self._patch({"roster_locked": True})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["roster_locked"])
        self.team.refresh_from_db()
        self.assertIsNotNone(self.team.roster_locked_at)

    def test_lock_is_idempotent_and_keeps_the_unchanged_name_writable(self):
        self._fill_to_full()
        self._patch({"team_name": "Đội A", "roster_locked": True})

        # Re-confirming (dialog reopened, page reloaded) and resending the
        # same name must stay fine — only a *changing* name is refused.
        response = self._patch({"team_name": "Đội A", "roster_locked": True})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["roster_locked"])

    def test_lock_refuses_an_incomplete_member(self):
        # Full roster (size ok), but one member is missing a required field, so
        # the per-member validation — which runs after the size gate — refuses it.
        self._fill_to_full(facebook="")

        response = self._patch({"roster_locked": True})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "missing:member_5:facebook")
        self.team.refresh_from_db()
        self.assertIsNone(self.team.roster_locked_at)

    def test_lock_allows_a_partial_roster_within_range(self):
        # 3 of 5 — within min..max range, so locking is allowed.
        self._add_member("SV002")
        self._add_member("SV003")

        response = self._patch({"roster_locked": True})

        self.assertEqual(response.status_code, 200)
        self.team.refresh_from_db()
        self.assertIsNotNone(self.team.roster_locked_at)

    def test_lock_refuses_an_over_full_roster(self):
        for index in range(2, 7):  # SV002..SV006 → 6 members with the captain
            self._add_member(f"SV{index:03d}")

        response = self._patch({"roster_locked": True})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "team_size_not_final:5")
        self.team.refresh_from_db()
        self.assertIsNone(self.team.roster_locked_at)

    def test_locked_roster_refuses_add_remove_and_rename_but_allows_edit(self):
        self._fill_to_full()
        self._patch({"team_name": "Đội A", "roster_locked": True})

        added = self.client.post(
            "/api/my-team/members",
            data=json.dumps({"mssv": "SV900", "email": "sv900@example.com"}),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(added.status_code, 409)
        self.assertEqual(added.json()["error"], "roster_locked")

        # A locked roster still shouldn't budge in size or in name — but
        # editing a member's own non-reference details (name, phone, ...)
        # must keep working, so a typo can be fixed while waiting on payment.
        edited = self.client.patch(
            "/api/my-team/members/SV002",
            data=json.dumps({"full_name": "Tên Khác"}),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()["full_name"], "Tên Khác")

        removed = self.client.delete("/api/my-team/members/SV002", **self._auth())
        self.assertEqual(removed.status_code, 409)
        self.assertEqual(removed.json()["error"], "roster_locked")

        renamed = self._patch({"team_name": "Tên Hoàn Toàn Khác"})
        self.assertEqual(renamed.status_code, 409)
        self.assertEqual(renamed.json()["error"], "roster_locked")

    def test_rejection_unlocks_the_roster(self):
        self._fill_to_full()
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
