from django.test import TestCase

from api.models import (
    Account,
    AuditLog,
    Participant,
    PendingDeprovision,
    Team,
    TeamMembership,
)
from api.services.auth_service import generate_session


class AdminDeleteTeamApiTests(TestCase):
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

    def test_delete_team_success(self):
        owner = Account.objects.create(
            username="owner_user",
            email="owner@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV0002",
        )
        team = Team.objects.create(
            code="T1001",
            name="Team To Delete",
            approval_status=Team.APPROVAL_PENDING,
            owner_account=owner,
        )
        p1 = Participant.objects.create(mssv="SV0002", full_name="Owner P", email="owner@example.com", account=owner)
        p2 = Participant.objects.create(mssv="SV0003", full_name="Member P", email="member@example.com")
        TeamMembership.objects.create(team=team, participant=p1, is_captain=True)
        TeamMembership.objects.create(team=team, participant=p2, is_captain=False)

        resp = self.client.delete(f"/api/teams/{team.code}", **self._auth(self.admin_token))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "deleted")
        self.assertEqual(data["code"], "T1001")
        self.assertEqual(data["name"], "Team To Delete")
        self.assertEqual(data["members_removed"], 2)

        self.assertFalse(Team.objects.filter(code="T1001").exists())
        self.assertEqual(TeamMembership.objects.filter(team__code="T1001").count(), 0)

    def test_delete_team_audit_log(self):
        owner = Account.objects.create(
            username="audit_owner",
            email="audit_owner@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV0010",
        )
        team = Team.objects.create(
            code="T1002",
            name="Team For Audit",
            approval_status=Team.APPROVAL_APPROVED,
            provision_state=Team.PROVISION_PENDING,
            owner_account=owner,
        )
        p = Participant.objects.create(mssv="SV0010", full_name="Audit P", email="audit_owner@example.com", account=owner)
        TeamMembership.objects.create(team=team, participant=p, is_captain=True)

        resp = self.client.delete(f"/api/teams/{team.code}", **self._auth(self.admin_token))
        self.assertEqual(resp.status_code, 200)

        log = AuditLog.objects.filter(target_type="Team", target_id="T1002").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.actor, self.admin)
        self.assertEqual(log.action, "team.delete")
        self.assertEqual(log.summary, f"Xóa đội {team.code} ({team.name})")
        self.assertFalse(log.reversible)
        self.assertIsNone(log.after_data)
        self.assertIsNotNone(log.before_data)
        self.assertEqual(log.before_data["code"], "T1002")
        self.assertEqual(log.before_data["name"], "Team For Audit")
        self.assertEqual(log.before_data["owner_username"], "audit_owner")
        self.assertEqual(log.before_data["approval_status"], Team.APPROVAL_APPROVED)
        self.assertEqual(log.before_data["provision_state"], Team.PROVISION_PENDING)
        self.assertEqual(log.before_data["member_count"], 1)

    def test_delete_team_discord_cleanup_queued(self):
        team = Team.objects.create(
            code="T1003",
            name="Discord Team",
            approval_status=Team.APPROVAL_APPROVED,
            discord_role_id=987654321,
            text_channel_id=123456789,
            voice_channel_id=456789123,
        )

        resp = self.client.delete(f"/api/teams/{team.code}", **self._auth(self.admin_token))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["discord_cleanup"], "queued")

        pending = PendingDeprovision.objects.filter(team_code="T1003").first()
        self.assertIsNotNone(pending)
        self.assertEqual(pending.discord_role_id, 987654321)
        self.assertEqual(pending.text_channel_id, 123456789)
        self.assertEqual(pending.voice_channel_id, 456789123)
        self.assertEqual(pending.team_code, "T1003")

    def test_delete_team_no_discord_cleanup(self):
        team = Team.objects.create(
            code="T1004",
            name="No Discord Team",
            approval_status=Team.APPROVAL_DRAFT,
            discord_role_id=None,
            text_channel_id=None,
            voice_channel_id=None,
        )

        resp = self.client.delete(f"/api/teams/{team.code}", **self._auth(self.admin_token))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["discord_cleanup"], "none")

        self.assertFalse(PendingDeprovision.objects.filter(team_code="T1004").exists())

    def test_delete_team_forbidden_participant(self):
        team = Team.objects.create(
            code="T1005",
            name="Participant Protected Team",
            approval_status=Team.APPROVAL_DRAFT,
        )

        resp = self.client.delete(f"/api/teams/{team.code}", **self._auth(self.participant_token))
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "forbidden")
        self.assertTrue(Team.objects.filter(code="T1005").exists())

    def test_delete_team_forbidden_collab(self):
        team = Team.objects.create(
            code="T1006",
            name="Collab Protected Team",
            approval_status=Team.APPROVAL_DRAFT,
        )

        resp = self.client.delete(f"/api/teams/{team.code}", **self._auth(self.collab_token))
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "forbidden")
        self.assertTrue(Team.objects.filter(code="T1006").exists())

    def test_delete_team_not_found(self):
        resp = self.client.delete("/api/teams/T9999", **self._auth(self.admin_token))
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "not_found")
