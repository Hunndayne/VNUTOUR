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

    def test_adding_member_with_captain_email_is_rejected(self):
        # Different MSSV but the captain's email: the MSSV dedup lets it through,
        # so the email guard must catch the duplicated identity.
        captain, team = self._captain_team()

        participant, error = add_member(
            team, "23520000", full_name="Impersonator",
            email="23521234@gm.uit.edu.vn", actor=captain,
        )

        self.assertEqual(error, "email_in_team")
        self.assertIsNone(participant)
        self.assertEqual(TeamMembership.objects.filter(team=team).count(), 1)

    def test_adding_member_with_another_members_email_is_rejected(self):
        captain, team = self._captain_team()
        add_member(
            team, "23520000", full_name="Quang Nguyen Tai",
            email="23520000@gm.uit.edu.vn", actor=captain,
        )

        _, error = add_member(
            team, "23520001", full_name="Second Member",
            email="23520000@gm.uit.edu.vn", actor=captain,
        )

        self.assertEqual(error, "email_in_team")
        self.assertEqual(TeamMembership.objects.filter(team=team).count(), 2)

    def test_email_match_is_case_insensitive(self):
        captain, team = self._captain_team()

        _, error = add_member(
            team, "23520000", full_name="Quang Nguyen Tai",
            email="23521234@GM.UIT.EDU.VN", actor=captain,
        )

        self.assertEqual(error, "email_in_team")

    def test_email_used_in_another_team_is_rejected(self):
        # Global uniqueness: an email already belonging to a participant on a
        # different team must be blocked, not just one on the same roster.
        captain, team = self._captain_team()
        add_member(
            team, "23520000", full_name="Quang Nguyen Tai",
            email="23520000@gm.uit.edu.vn", actor=captain,
        )

        other_captain = Account.objects.create(
            username="cap-other",
            email="23528888@gm.uit.edu.vn",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="23528888",
            full_name="Other Captain",
        )
        other_team, _ = create_team("PH-OTHER", owner_account=other_captain)
        add_member(
            other_team, "23528888", full_name="Other Captain",
            email="23528888@gm.uit.edu.vn", is_captain=True, actor=other_captain,
        )

        _, error = add_member(
            other_team, "23527777", full_name="Reuser",
            email="23520000@gm.uit.edu.vn", actor=other_captain,
        )

        self.assertEqual(error, "email_in_team")

    def test_unclaimed_account_email_does_not_block_same_person(self):
        # Reverse order: the member signed up via Google first (account holds the
        # email but no MSSV yet), then the captain adds them by MSSV + same email.
        # This is the same person and must be allowed — it auto-links on next login.
        captain, team = self._captain_team()
        Account.objects.create(
            username="early",
            email="early@gm.uit.edu.vn",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv=None,
            full_name="Early Bird",
        )

        participant, error = add_member(
            team, "23520000", full_name="Early Bird",
            email="early@gm.uit.edu.vn", actor=captain,
        )

        self.assertIsNone(error)
        self.assertEqual(participant.mssv, "23520000")

    def test_email_owned_by_another_account_is_rejected(self):
        # An account (even one without a team yet) reserves its email too.
        captain, team = self._captain_team()
        Account.objects.create(
            username="lone",
            email="lone@gm.uit.edu.vn",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="23526666",
            full_name="Lone Account",
        )

        _, error = add_member(
            team, "23520000", full_name="Quang Nguyen Tai",
            email="lone@gm.uit.edu.vn", actor=captain,
        )

        self.assertEqual(error, "email_in_team")

    def test_same_member_can_be_re_added_with_own_email(self):
        # Guard must not misfire on the member's own email when the MSSV is new;
        # only a *different* MSSV reusing an existing email is blocked.
        captain, team = self._captain_team()

        participant, error = add_member(
            team, "23520000", full_name="Quang Nguyen Tai",
            email="23520000@gm.uit.edu.vn", actor=captain,
        )

        self.assertIsNone(error)
        self.assertEqual(participant.mssv, "23520000")


class AddMemberDraftMoveTests(TestCase):
    """A member sitting in an unsubmitted (draft/rejected) team is moved out of
    it rather than blocking the add; a submitted team locks the member."""

    def _account(self, mssv, name, email):
        return Account.objects.create(
            username=mssv, email=email, password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv=mssv, full_name=name,
        )

    def _team_with_captain(self, code, captain):
        team, _ = create_team(code, owner_account=captain)
        add_member(
            team, captain.mssv, full_name=captain.full_name,
            email=captain.email, is_captain=True, actor=captain,
        )
        return team

    def test_move_solo_draft_member_dissolves_old_team(self):
        a_cap = self._account("23520001", "Captain A", "23520001@x.com")
        team_a = self._team_with_captain("A1", a_cap)
        b_cap = self._account("23520002", "Bee", "23520002@x.com")
        team_b = self._team_with_captain("B1", b_cap)  # B: solo draft captain

        participant, error = add_member(
            team_a, "23520002", full_name="Bee",
            email="23520002@x.com", actor=a_cap,
        )

        self.assertIsNone(error)
        self.assertIsNotNone(participant)
        moved = TeamMembership.objects.get(participant__mssv="23520002")
        self.assertEqual(moved.team_id, team_a.id)
        self.assertFalse(moved.is_captain)  # captaincy not inherited
        self.assertFalse(Team.objects.filter(pk=team_b.pk).exists())

    def test_move_draft_captain_dissolves_team_and_frees_other_members(self):
        a_cap = self._account("23520010", "Captain A", "23520010@x.com")
        team_a = self._team_with_captain("A2", a_cap)
        b_cap = self._account("23520011", "Bee", "23520011@x.com")
        team_b = self._team_with_captain("B2", b_cap)
        add_member(  # C is a plain member of B's draft team
            team_b, "23520012", full_name="Cee",
            email="23520012@x.com", actor=b_cap,
        )

        _, error = add_member(
            team_a, "23520011", full_name="Bee",
            email="23520011@x.com", actor=a_cap,
        )

        self.assertIsNone(error)
        self.assertFalse(Team.objects.filter(pk=team_b.pk).exists())
        # The whole draft team was dissolved: C is now teamless.
        self.assertFalse(
            TeamMembership.objects.filter(participant__mssv="23520012").exists()
        )
        self.assertEqual(
            TeamMembership.objects.get(participant__mssv="23520011").team_id,
            team_a.id,
        )

    def test_move_plain_draft_member_keeps_old_team(self):
        x_cap = self._account("23520020", "Ex Captain", "23520020@x.com")
        team_x = self._team_with_captain("X3", x_cap)
        add_member(  # B is a plain member of X's draft team
            team_x, "23520021", full_name="Bee",
            email="23520021@x.com", actor=x_cap,
        )
        a_cap = self._account("23520022", "Captain A", "23520022@x.com")
        team_a = self._team_with_captain("A3", a_cap)

        _, error = add_member(
            team_a, "23520021", full_name="Bee",
            email="23520021@x.com", actor=a_cap,
        )

        self.assertIsNone(error)
        self.assertEqual(
            TeamMembership.objects.get(participant__mssv="23520021").team_id,
            team_a.id,
        )
        # X's team survives — B was only a member, and X still captains it.
        self.assertTrue(Team.objects.filter(pk=team_x.pk).exists())
        self.assertTrue(
            TeamMembership.objects.filter(
                team=team_x, participant__mssv="23520020"
            ).exists()
        )

    def test_member_in_submitted_team_is_locked(self):
        b_cap = self._account("23520030", "Bee", "23520030@x.com")
        team_b = self._team_with_captain("B4", b_cap)
        Team.objects.filter(pk=team_b.pk).update(
            approval_status=Team.APPROVAL_PENDING
        )
        a_cap = self._account("23520031", "Captain A", "23520031@x.com")
        team_a = self._team_with_captain("A4", a_cap)

        participant, error = add_member(
            team_a, "23520030", full_name="Bee",
            email="23520030@x.com", actor=a_cap,
        )

        self.assertEqual(error, "mssv_in_submitted_team")
        self.assertIsNone(participant)
        # B stays put, and the submitted team is untouched.
        self.assertEqual(
            TeamMembership.objects.get(participant__mssv="23520030").team_id,
            team_b.id,
        )
        self.assertTrue(Team.objects.filter(pk=team_b.pk).exists())
