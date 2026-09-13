from django.test import TestCase

from api.models import (
    Account,
    AuditLog,
    Participant,
    Team,
    TeamMembership,
)
from api.services.auth_service import generate_session


class AdminRemoveMemberApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin_user",
            email="admin@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
            mssv="ADMIN01",
        )
        self.admin_token = generate_session(self.admin)

        self.collab = Account.objects.create(
            username="collab_user",
            email="collab@example.com",
            password_hash="x",
            role=Account.ROLE_COLLAB,
            mssv="COLLAB01",
        )
        self.collab_token = generate_session(self.collab)

        self.participant = Account.objects.create(
            username="part_user",
            email="part@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV0001",
        )
        self.participant_token = generate_session(self.participant)

    def _auth(self, token):
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def _team_with_two_members(self, code="T2001", status=Team.APPROVAL_APPROVED):
        team = Team.objects.create(code=code, name="Roster Team", approval_status=status)
        captain = Participant.objects.create(
            mssv="SV0002", full_name="Captain P", email="captain@example.com"
        )
        member = Participant.objects.create(
            mssv="SV0003", full_name="Member P", email="member@example.com"
        )
        TeamMembership.objects.create(team=team, participant=captain, is_captain=True)
        TeamMembership.objects.create(team=team, participant=member, is_captain=False)
        return team

    def test_remove_member_success(self):
        team = self._team_with_two_members()

        resp = self.client.delete(
            f"/api/teams/{team.code}/members/SV0003", **self._auth(self.admin_token)
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "removed")
        self.assertEqual(data["mssv"], "SV0003")

        self.assertFalse(
            TeamMembership.objects.filter(
                team=team, participant__mssv="SV0003"
            ).exists()
        )
        # The other member and the participant profile itself remain.
        self.assertTrue(
            TeamMembership.objects.filter(team=team, participant__mssv="SV0002").exists()
        )
        self.assertTrue(Participant.objects.filter(mssv="SV0003").exists())

    def test_remove_member_case_insensitive_mssv(self):
        team = self._team_with_two_members(code="T2007")

        resp = self.client.delete(
            f"/api/teams/{team.code}/members/sv0003", **self._auth(self.admin_token)
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["mssv"], "SV0003")
        self.assertFalse(
            TeamMembership.objects.filter(
                team=team, participant__mssv="SV0003"
            ).exists()
        )

    def test_remove_member_audit_log(self):
        team = self._team_with_two_members(code="T2002")

        resp = self.client.delete(
            f"/api/teams/{team.code}/members/SV0003", **self._auth(self.admin_token)
        )
        self.assertEqual(resp.status_code, 200)

        log = AuditLog.objects.filter(
            action="team.member.remove", target_id=str(team.id)
        ).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.actor, self.admin)
        self.assertEqual(log.target_type, "Team")
        self.assertFalse(log.reversible)
        self.assertIsNone(log.after_data)
        self.assertEqual(log.before_data["mssv"], "SV0003")
        self.assertEqual(log.before_data["full_name"], "Member P")
        self.assertFalse(log.before_data["is_captain"])

    def test_remove_captain_allowed(self):
        team = self._team_with_two_members(code="T2003")

        resp = self.client.delete(
            f"/api/teams/{team.code}/members/SV0002", **self._auth(self.admin_token)
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            TeamMembership.objects.filter(
                team=team, participant__mssv="SV0002"
            ).exists()
        )

    def test_remove_member_not_on_team(self):
        team = self._team_with_two_members(code="T2004")

        resp = self.client.delete(
            f"/api/teams/{team.code}/members/SV9999", **self._auth(self.admin_token)
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "not_found")

    def test_remove_member_team_not_found(self):
        resp = self.client.delete(
            "/api/teams/T9999/members/SV0003", **self._auth(self.admin_token)
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "not_found")

    def test_remove_member_forbidden_collab(self):
        team = self._team_with_two_members(code="T2005")

        resp = self.client.delete(
            f"/api/teams/{team.code}/members/SV0003", **self._auth(self.collab_token)
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "forbidden")
        self.assertTrue(
            TeamMembership.objects.filter(
                team=team, participant__mssv="SV0003"
            ).exists()
        )

    def test_remove_member_forbidden_participant(self):
        team = self._team_with_two_members(code="T2006")

        resp = self.client.delete(
            f"/api/teams/{team.code}/members/SV0003", **self._auth(self.participant_token)
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "forbidden")

    def test_remove_member_rejects_get(self):
        team = self._team_with_two_members(code="T2008")

        resp = self.client.get(
            f"/api/teams/{team.code}/members/SV0003", **self._auth(self.admin_token)
        )
        self.assertEqual(resp.status_code, 405)
