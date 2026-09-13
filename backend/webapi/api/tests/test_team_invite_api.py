from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone

from api.models import Account, Participant, SystemSetting, Team, TeamInviteLink, TeamMembership
from api.services.auth_service import generate_session


class TeamInviteApiTests(TestCase):
    def setUp(self):
        SystemSetting.objects.create(key="registration_open", value=True)
        self.captain_account = Account.objects.create(
            username="captain",
            email="captain@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="CAP001",
            full_name="Captain",
        )
        captain = Participant.objects.create(
            account=self.captain_account,
            mssv="CAP001",
            email="captain@example.com",
            full_name="Captain",
        )
        self.team = Team.objects.create(
            code="T0001",
            name="Pending team CAP001",
            owner_account=self.captain_account,
            approval_status=Team.APPROVAL_DRAFT,
        )
        TeamMembership.objects.create(team=self.team, participant=captain, is_captain=True)
        self.member_account = Account.objects.create(
            username="member",
            email="member@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="MEM001",
            full_name="Member One",
            school="UIT",
            faculty="Computer Science",
            phone="0900000001",
        )
        self.member = Participant.objects.create(
            account=self.member_account,
            mssv="MEM001",
            email="member@example.com",
            full_name="Member One",
            school="UIT",
            faculty="Computer Science",
            phone="0900000001",
            facebook="https://facebook.com/member-one",
            cccd="UIT",
            date_of_birth=date(2005, 1, 1),
            extra={"gender": "other"},
        )

    def _auth(self, account):
        return {"HTTP_AUTHORIZATION": f"Bearer {generate_session(account)}"}

    def test_captain_issues_three_hour_link_and_member_accepts_it(self):
        issued = self.client.post("/api/my-team/invite", **self._auth(self.captain_account))

        self.assertEqual(issued.status_code, 201)
        self.assertEqual(issued.json()["ttl_seconds"], 10800)
        token = issued.json()["token"]
        invite = TeamInviteLink.objects.get(team=self.team)
        remaining = invite.expires_at - timezone.now()
        self.assertGreater(remaining, timedelta(hours=2, minutes=59))
        self.assertNotEqual(invite.token_hash, token)

        preview = self.client.get(f"/api/team-invites/{token}")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json()["team"]["code"], self.team.code)
        self.assertIn("registration_slots_remaining", preview.json())

        accepted = self.client.post(
            f"/api/team-invites/{token}",
            **self._auth(self.member_account),
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["status"], "joined")
        self.assertTrue(TeamMembership.objects.filter(team=self.team, participant=self.member).exists())
        invite.refresh_from_db()
        self.assertEqual(invite.use_count, 1)

    def test_new_link_invalidates_previous_link(self):
        first = self.client.post("/api/my-team/invite", **self._auth(self.captain_account)).json()["token"]
        second = self.client.post("/api/my-team/invite", **self._auth(self.captain_account)).json()["token"]

        self.assertNotEqual(first, second)
        self.assertEqual(self.client.get(f"/api/team-invites/{first}").status_code, 410)
        self.assertEqual(self.client.get(f"/api/team-invites/{second}").status_code, 200)

    def test_expired_link_cannot_be_accepted(self):
        token = self.client.post("/api/my-team/invite", **self._auth(self.captain_account)).json()["token"]
        TeamInviteLink.objects.filter(team=self.team).update(
            expires_at=timezone.now() - timedelta(seconds=1),
        )

        response = self.client.post(f"/api/team-invites/{token}", **self._auth(self.member_account))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "invite_expired")
        self.assertFalse(TeamMembership.objects.filter(team=self.team, participant=self.member).exists())

    def test_non_captain_cannot_issue_link(self):
        response = self.client.post("/api/my-team/invite", **self._auth(self.member_account))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "not_team_owner")

    def test_incomplete_profile_must_be_completed_before_joining(self):
        incomplete_account = Account.objects.create(
            username="incomplete",
            email="incomplete@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="MEM002",
            full_name="Incomplete Member",
        )
        incomplete_profile = Participant.objects.create(
            account=incomplete_account,
            mssv="MEM002",
            email="incomplete@example.com",
            full_name="Incomplete Member",
        )
        token = self.client.post(
            "/api/my-team/invite", **self._auth(self.captain_account),
        ).json()["token"]

        profile_response = self.client.get(
            "/api/me/profile", **self._auth(incomplete_account),
        )
        self.assertFalse(profile_response.json()["profile_complete"])

        response = self.client.post(
            f"/api/team-invites/{token}", **self._auth(incomplete_account),
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "profile_incomplete")
        self.assertFalse(TeamMembership.objects.filter(participant=incomplete_profile).exists())
