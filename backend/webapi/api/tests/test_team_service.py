from django.test import TestCase
from unittest.mock import patch

from api.models import Account, Participant, Team, TeamMembership
from api.services.team_service import (
    add_member,
    create_team,
    get_team_members,
    link_account_profile,
)


class TeamServiceTests(TestCase):
    @patch("api.services.team_service._next_team_code", side_effect=["T9001", "T9002"])
    def test_create_team_retries_when_generated_code_conflicts(self, next_code):
        Team.objects.create(code="T9001", name="Existing team")

        team, error = create_team("New team")

        self.assertIsNone(error)
        self.assertEqual(team.code, "T9002")
        self.assertTrue(Team.objects.filter(code="T9002", name="New team").exists())
        self.assertEqual(next_code.call_count, 2)

    def test_get_team_members_syncs_active_account_profile(self):
        account = Account.objects.create(
            username="member1",
            email="member1@gmail.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="26520002",
            full_name="Member One",
            phone="0922222222",
            school="UIT",
            faculty="MMT",
        )
        participant = Participant.objects.create(
            account=account,
            mssv="26520002",
            full_name="Member One",
            email="member1@gmail.com",
        )
        team = Team.objects.create(code="T9001", name="Team")
        TeamMembership.objects.create(team=team, participant=participant)

        members = get_team_members(team)

        self.assertEqual(members[0]["phone"], "0922222222")
        self.assertEqual(members[0]["school"], "UIT")
        self.assertEqual(members[0]["faculty"], "MMT")
        participant.refresh_from_db()
        self.assertEqual(participant.phone, "0922222222")
        self.assertEqual(participant.school, "UIT")
        self.assertEqual(participant.faculty, "MMT")

    def test_link_account_profile_syncs_newly_linked_participant(self):
        account = Account.objects.create(
            username="captain",
            email="captain@gmail.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="26520000",
            full_name="Captain",
            phone="0911111111",
            school="UIT",
            faculty="KHMT",
        )
        participant = Participant.objects.create(
            mssv="26520000",
            full_name="Old Captain",
            email="old@gmail.com",
        )

        linked_participant, status = link_account_profile(account)

        self.assertEqual(linked_participant, participant)
        self.assertEqual(status, "overwritten")
        participant.refresh_from_db()
        self.assertEqual(participant.account, account)
        self.assertEqual(participant.full_name, "Captain")
        self.assertEqual(participant.email, "captain@gmail.com")
        self.assertEqual(participant.phone, "0911111111")
        self.assertEqual(participant.school, "UIT")
        self.assertEqual(participant.faculty, "KHMT")

    def test_link_account_profile_syncs_existing_linked_participant(self):
        account = Account.objects.create(
            username="thisinh1",
            email="thisinh1@gmail.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="26520001",
            full_name="thisinh1",
            phone="0900000000",
            school="UIT",
            faculty="Mang",
        )
        participant = Participant.objects.create(
            account=account,
            mssv="26520001",
            full_name="thisinh1",
            email="thisinh1@gmail.com",
        )

        linked_participant, status = link_account_profile(account)

        self.assertEqual(linked_participant, participant)
        self.assertIsNone(status)
        participant.refresh_from_db()
        self.assertEqual(participant.phone, "0900000000")
        self.assertEqual(participant.school, "UIT")
        self.assertEqual(participant.faculty, "Mang")


class AddMemberDuplicateTests(TestCase):
    def _captain_team(self):
        captain = Account.objects.create(
            username="cap",
            email="23521234@gm.uit.edu.vn",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="23521234",
            full_name="Nguyen Van A",
        )
        team, _ = create_team("PH-TEAM", owner_account=captain)
        add_member(
            team, "23521234", full_name="Nguyen Van A",
            email="23521234@gm.uit.edu.vn", is_captain=True, actor=captain,
        )
        return captain, team

    def test_adding_captain_mssv_as_member_is_rejected(self):
        captain, team = self._captain_team()

        participant, error = add_member(
            team, "23521234", full_name="Nguyen Van A",
            email="23521234@gm.uit.edu.vn", actor=captain,
        )

        self.assertEqual(error, "already_in_team")
        self.assertIsNone(participant)
        # No duplicate row slipped into the roster.
        self.assertEqual(TeamMembership.objects.filter(team=team).count(), 1)

    def test_adding_existing_member_mssv_again_is_rejected(self):
        captain, team = self._captain_team()
        add_member(
            team, "23520000", full_name="Quang Nguyen Tai",
            email="23520000@gm.uit.edu.vn", actor=captain,
        )

        _, error = add_member(
            team, "23520000", full_name="Quang Nguyen Tai",
            email="23520000@gm.uit.edu.vn", actor=captain,
        )

        self.assertEqual(error, "already_in_team")
        self.assertEqual(TeamMembership.objects.filter(team=team).count(), 2)

    def test_adding_owner_mssv_without_captain_membership_is_rejected(self):
        # The owner is shown separately in the roster and may not yet hold a
        # membership row; adding their MSSV as a member must still be blocked.
        captain = Account.objects.create(
            username="cap2",
            email="23529999@gm.uit.edu.vn",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="23529999",
            full_name="Owner No Membership",
        )
        team, _ = create_team("PH-TEAM-2", owner_account=captain)

        _, error = add_member(
            team, "23529999", full_name="Owner No Membership",
            email="23529999@gm.uit.edu.vn", actor=captain,
        )

        self.assertEqual(error, "already_in_team")
        self.assertFalse(TeamMembership.objects.filter(team=team).exists())

    def test_adding_distinct_member_still_works(self):
        captain, team = self._captain_team()

        participant, error = add_member(
            team, "23520000", full_name="Quang Nguyen Tai",
            email="23520000@gm.uit.edu.vn", actor=captain,
        )

        self.assertIsNone(error)
        self.assertEqual(participant.mssv, "23520000")
        self.assertEqual(TeamMembership.objects.filter(team=team).count(), 2)
