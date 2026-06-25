from django.test import TestCase

from api.models import Account, Participant, Team, TeamMembership
from api.services.team_service import get_team_members, link_account_profile


class TeamServiceTests(TestCase):
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
