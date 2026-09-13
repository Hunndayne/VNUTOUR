"""Admin team list/detail shows the real captain, not a stale owner_account.

owner_account is stamped at team creation and never re-synced, so it goes stale
when the captain leaves or changes their MSSV. The admin "đội trưởng" must come
from the is_captain membership instead, or it shows a ghost leader.
"""

from django.test import TestCase

from api.models import Account, Participant, Team, TeamMembership
from api.services.auth_service import generate_session


class AdminTeamLeaderDisplayTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin1", email="admin1@x.com", password_hash="x",
            role=Account.ROLE_ADMIN, mssv="admin1",
        )
        self.token = generate_session(self.admin)

    def _row(self, code):
        resp = self.client.get(
            "/api/teams", HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(resp.status_code, 200)
        return next(t for t in resp.json()["items"] if t["code"] == code)

    def _detail(self, code):
        resp = self.client.get(
            f"/api/teams/{code}", HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(resp.status_code, 200)
        return resp.json()

    def test_leader_is_the_captain_member_not_stale_owner(self):
        # owner_account points at an account that is no longer on the roster
        # (e.g. it changed MSSV) — the real captain is a different membership.
        ghost = Account.objects.create(
            username="ghostowner", email="ghost@x.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="99999",
        )
        team = Team.objects.create(
            code="T5001", name="Team", approval_status=Team.APPROVAL_DRAFT,
            owner_account=ghost,
        )
        cap = Participant.objects.create(mssv="123", full_name="Real Captain", email="cap@x.com")
        mem = Participant.objects.create(mssv="234", full_name="Member", email="mem@x.com")
        TeamMembership.objects.create(team=team, participant=cap, is_captain=True)
        TeamMembership.objects.create(team=team, participant=mem, is_captain=False)

        row = self._row("T5001")
        self.assertNotEqual(row["owner_username"], "ghostowner")
        self.assertEqual(row["owner_username"], "Real Captain")
        self.assertEqual(row["captain_name"], "Real Captain")
        self.assertEqual(row["captain_mssv"], "123")

    def test_leader_exposes_participant_name_and_mssv_in_list_and_detail(self):
        cap_acc = Account.objects.create(
            username="capuser", email="capuser@x.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="555",
        )
        team = Team.objects.create(
            code="T5002", name="Team2", approval_status=Team.APPROVAL_DRAFT,
        )
        cap = Participant.objects.create(
            mssv="555", full_name="Cap Full", email="capuser@x.com", account=cap_acc,
        )
        TeamMembership.objects.create(team=team, participant=cap, is_captain=True)

        row = self._row("T5002")
        detail = self._detail("T5002")
        self.assertEqual(row["owner_username"], "capuser")
        self.assertEqual(row["captain_name"], "Cap Full")
        self.assertEqual(row["captain_mssv"], "555")
        self.assertEqual(detail["captain_name"], "Cap Full")
        self.assertEqual(detail["captain_mssv"], "555")

    def test_team_search_matches_displayed_captain_name_and_mssv(self):
        team = Team.objects.create(
            code="T5004", name="Unrelated", approval_status=Team.APPROVAL_DRAFT,
        )
        cap = Participant.objects.create(
            mssv="24681012", full_name="Nguyễn Hoài An", email="hoaian@x.com",
        )
        TeamMembership.objects.create(team=team, participant=cap, is_captain=True)

        for query in ("Hoài An", "24681012"):
            resp = self.client.get(
                "/api/teams", {"q": query},
                HTTP_AUTHORIZATION=f"Bearer {self.token}",
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual([item["code"] for item in resp.json()["items"]], ["T5004"])

    def test_falls_back_to_owner_when_roster_has_no_captain(self):
        owner = Account.objects.create(
            username="soloowner", email="solo@x.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="777", full_name="Solo Owner",
        )
        team = Team.objects.create(
            code="T5003", name="Team3", approval_status=Team.APPROVAL_DRAFT,
            owner_account=owner,
        )
        p = Participant.objects.create(mssv="778", full_name="NoCap", email="nocap@x.com")
        TeamMembership.objects.create(team=team, participant=p, is_captain=False)

        row = self._row("T5003")
        self.assertEqual(row["owner_username"], "soloowner")
        self.assertEqual(row["captain_name"], "Solo Owner")
        self.assertEqual(row["captain_mssv"], "777")
