import json

from django.test import TestCase

from api.models import (
    Account,
    Participant,
    ProgramPhase,
    SubEvent,
    SystemSetting,
    Team,
    TeamMembership,
)
from api.services.auth_service import generate_session
from api.services.program_service import set_current_phase


class TeamPrivacyTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.collab = Account.objects.create(
            username="collab",
            email="collab@example.com",
            password_hash="x",
            role=Account.ROLE_COLLAB,
        )
        self.member_account = Account.objects.create(
            username="member",
            email="member@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV001",
        )
        self.other_account = Account.objects.create(
            username="other",
            email="other@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV999",
        )
        self.team = Team.objects.create(
            code="T0001",
            name="Team A",
            owner_account=self.member_account,
            approval_status=Team.APPROVAL_APPROVED,
            qr_token="secret-token",
        )
        self.member = Participant.objects.create(
            account=self.member_account,
            mssv="SV001",
            full_name="Nguyen Van A",
            email="member@example.com",
            phone="0900000000",
            school="UIT",
            faculty="KHMT",
            facebook="https://example.com/member",
            cccd="012345678901",
        )
        self.teammate = Participant.objects.create(
            mssv="SV002",
            full_name="Tran Van B",
            email="teammate@example.com",
            phone="0911111111",
            school="US",
            faculty="Toan",
            facebook="https://example.com/teammate",
            cccd="109876543210",
        )
        TeamMembership.objects.create(
            team=self.team,
            participant=self.member,
            is_captain=True,
        )
        TeamMembership.objects.create(
            team=self.team,
            participant=self.teammate,
        )

    def _auth(self, account):
        return {"HTTP_AUTHORIZATION": f"Bearer {generate_session(account)}"}

    def test_participant_cannot_browse_other_teams(self):
        response = self.client.get("/api/teams", **self._auth(self.other_account))
        self.assertEqual(response.status_code, 403)

        response = self.client.get(
            f"/api/teams/{self.team.code}",
            **self._auth(self.other_account),
        )
        self.assertEqual(response.status_code, 403)

    def test_collab_only_sees_basic_member_identity(self):
        response = self.client.get(
            f"/api/teams/{self.team.code}",
            **self._auth(self.collab),
        )
        self.assertEqual(response.status_code, 200)

        member = response.json()["members"][0]
        self.assertEqual(set(member), {"mssv", "full_name", "school"})

    def test_admin_sees_full_member_profile(self):
        response = self.client.get(
            f"/api/teams/{self.team.code}",
            **self._auth(self.admin),
        )
        self.assertEqual(response.status_code, 200)
        member = response.json()["members"][0]
        self.assertEqual(member["email"], "member@example.com")
        self.assertEqual(member["cccd"], "012345678901")

    def test_own_team_only_exposes_full_profile_for_current_account(self):
        response = self.client.get("/api/my-team", **self._auth(self.member_account))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertNotIn("qr_token", body["team"])

        members = {item["mssv"]: item for item in body["members"]}
        self.assertEqual(members["SV001"]["email"], "member@example.com")
        self.assertEqual(set(members["SV002"]), {"mssv", "full_name", "school"})

    def test_captain_cannot_edit_profile_owned_by_another_account(self):
        teammate_account = Account.objects.create(
            username="teammate",
            email="teammate@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV002",
        )
        self.teammate.account = teammate_account
        self.teammate.save(update_fields=["account", "updated_at"])
        self.team.approval_status = Team.APPROVAL_DRAFT
        self.team.save(update_fields=["approval_status", "updated_at"])
        SystemSetting.objects.update_or_create(
            key="registration_open",
            defaults={"value": True},
        )

        response = self.client.patch(
            "/api/my-team/members/SV002",
            data=json.dumps({
                "mssv": "SV002",
                "email": "teammate@example.com",
                "full_name": "Changed",
            }),
            content_type="application/json",
            **self._auth(self.member_account),
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "member_profile_owned")

    def test_captain_cannot_overwrite_owned_profile_by_removing_and_re_adding(self):
        """The `member_profile_owned` guard must not be bypassable via DELETE + POST."""
        teammate_account = Account.objects.create(
            username="teammate",
            email="teammate@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV002",
        )
        self.teammate.account = teammate_account
        self.teammate.save(update_fields=["account", "updated_at"])
        self.team.approval_status = Team.APPROVAL_DRAFT
        self.team.save(update_fields=["approval_status", "updated_at"])
        SystemSetting.objects.update_or_create(
            key="registration_open",
            defaults={"value": True},
        )

        removed = self.client.delete(
            "/api/my-team/members/SV002",
            **self._auth(self.member_account),
        )
        self.assertEqual(removed.status_code, 200)

        re_added = self.client.post(
            "/api/my-team/members",
            data=json.dumps({
                "mssv": "SV002",
                "email": "teammate@example.com",
                "full_name": "Hijacked Name",
                "school": "US",
                "faculty": "Toan",
                "phone": "0999999999",
                "cccd": "999999999999",
                "date_of_birth": "2001-01-01",
                "facebook": "https://example.com/hijacked",
            }),
            content_type="application/json",
            **self._auth(self.member_account),
        )
        self.assertEqual(re_added.status_code, 201)

        self.teammate.refresh_from_db()
        self.assertEqual(self.teammate.full_name, "Tran Van B")
        self.assertEqual(self.teammate.cccd, "109876543210")
        self.assertEqual(self.teammate.facebook, "https://example.com/teammate")
        self.assertEqual(self.teammate.phone, "0911111111")
        self.assertIsNone(self.teammate.date_of_birth)
        self.assertTrue(
            TeamMembership.objects.filter(team=self.team, participant=self.teammate).exists()
        )

    def test_admin_registration_switch_blocks_team_changes_even_in_registration_phase(self):
        ProgramPhase.objects.create(
            key="registration",
            label="Registration",
            order=0,
            is_current=True,
        )
        SystemSetting.objects.update_or_create(
            key="registration_open",
            defaults={"value": False},
        )

        response = self.client.patch(
            "/api/my-team",
            data=json.dumps({"team_name": "Changed while closed"}),
            content_type="application/json",
            **self._auth(self.member_account),
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "registration_closed")


class RegistrationClosedTests(TestCase):
    def setUp(self):
        SystemSetting.objects.create(key="registration_open", value=False)

    def test_public_individual_registration_is_closed(self):
        response = self.client.post(
            "/api/register/individual",
            data=json.dumps({"mssv": "SV001"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "registration_closed")

    def test_public_team_registration_is_closed(self):
        response = self.client.post(
            "/api/register/team",
            data=json.dumps({"team_name": "Closed Team"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "registration_closed")


class PhaseTransitionSafetyTests(TestCase):
    def setUp(self):
        self.registration = ProgramPhase.objects.create(
            key="registration",
            label="Registration",
            order=1,
            is_current=True,
        )
        self.qualifying = ProgramPhase.objects.create(
            key="qualifying",
            label="Qualifying",
            order=2,
        )
        self.old_event = SubEvent.objects.create(
            phase=self.registration,
            name="Registration event",
        )
        SystemSetting.objects.create(
            key="current_sub_event_id",
            value=self.old_event.id,
        )

    def test_invalid_phase_does_not_clear_current_phase(self):
        with self.assertRaises(ProgramPhase.DoesNotExist):
            set_current_phase("missing")

        self.registration.refresh_from_db()
        self.assertTrue(self.registration.is_current)

    def test_switching_phase_preserves_history_and_clears_old_current_event(self):
        set_current_phase(self.qualifying.key)

        self.registration.refresh_from_db()
        self.qualifying.refresh_from_db()
        self.assertFalse(self.registration.is_current)
        self.assertTrue(self.qualifying.is_current)
        self.assertTrue(SubEvent.objects.filter(id=self.old_event.id).exists())
        self.assertFalse(
            SystemSetting.objects.filter(
                key="current_sub_event_id",
                value=self.old_event.id,
            ).exists(),
        )
