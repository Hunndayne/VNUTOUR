"""Naming a team through the participant dashboard's /api/my-team endpoints.

The dashboard flow is: enter members first, then name the team on the team
step, then pay. That means:
  - a team carries a stand-in name until its captain names it, and GET
    /api/my-team says which of the two it is carrying (`name_is_placeholder`)
  - the captain may name the team at any roster size — an under-strength team
    no longer has to wait until it is full (a merge resets the name anyway)
  - naming stays captain-only
"""

from django.test import TestCase

from api.models import Account, Participant, ProgramPhase, SystemSetting, Team, TeamMembership
from api.services.auth_service import generate_session


class MyTeamNamingTestBase(TestCase):
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
        self.participant = Participant.objects.create(
            account=self.account,
            mssv="SV001",
            full_name="Nguyễn Văn A",
            email="captain@example.com",
        )
        self.team = Team.objects.create(
            code="T0001", name="Pending team SV001", owner_account=self.account,
        )
        TeamMembership.objects.create(
            team=self.team, participant=self.participant, is_captain=True,
        )
        self.token = generate_session(self.account)

    def _member_token(self):
        account = Account.objects.create(
            username="member1", email="member1@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV002",
        )
        participant = Participant.objects.create(
            account=account, mssv="SV002", full_name="Thành Viên",
            email="member1@example.com",
        )
        TeamMembership.objects.create(team=self.team, participant=participant, is_captain=False)
        return generate_session(account)


class MyTeamNamePlaceholderFlagTests(MyTeamNamingTestBase):
    def test_creation_placeholder_is_flagged(self):
        response = self.client.get(
            "/api/my-team",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["team"]["name"], "Pending team SV001")
        self.assertTrue(payload["team"]["name_is_placeholder"])

    def test_merged_team_name_equal_to_code_is_flagged(self):
        self.team.name = self.team.code
        self.team.save(update_fields=["name"])

        response = self.client.get(
            "/api/my-team",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertTrue(response.json()["team"]["name_is_placeholder"])

    def test_captain_chosen_name_is_not_flagged(self):
        self.team.name = "Đội Nguồn Sông"
        self.team.save(update_fields=["name"])

        response = self.client.get(
            "/api/my-team",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertFalse(response.json()["team"]["name_is_placeholder"])


class MyTeamRenameTests(MyTeamNamingTestBase):
    def test_captain_renames_an_under_strength_team(self):
        response = self.client.patch(
            "/api/my-team",
            data={"team_name": "Đội Buôn Ký"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "Đội Buôn Ký")
        self.team.refresh_from_db()
        self.assertEqual(self.team.name, "Đội Buôn Ký")

    def test_rename_still_requires_the_captain(self):
        response = self.client.patch(
            "/api/my-team",
            data={"team_name": "Tên Nhóm"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self._member_token()}",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "not_team_owner")

    def test_rename_rejects_an_empty_name(self):
        response = self.client.patch(
            "/api/my-team",
            data={"team_name": "   "},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "missing_team_name")

    def test_creation_still_refuses_a_supplied_name(self):
        TeamMembership.objects.filter(team=self.team).delete()
        self.team.delete()

        response = self.client.post(
            "/api/my-team",
            data={"team_name": "Tên Ngay Khi Tạo"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "team_created_unnamed")
