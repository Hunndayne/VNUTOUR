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

    def test_leader_prefers_linked_account_username(self):
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

        self.assertEqual(self._row("T5002")["owner_username"], "capuser")

    def test_falls_back_to_owner_when_roster_has_no_captain(self):
        owner = Account.objects.create(
            username="soloowner", email="solo@x.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="777",
        )
        team = Team.objects.create(
            code="T5003", name="Team3", approval_status=Team.APPROVAL_DRAFT,
            owner_account=owner,
        )
        p = Participant.objects.create(mssv="778", full_name="NoCap", email="nocap@x.com")
        TeamMembership.objects.create(team=team, participant=p, is_captain=False)

        self.assertEqual(self._row("T5003")["owner_username"], "soloowner")
