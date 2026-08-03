"""Merging under-strength teams, and the captain ballot that follows."""

from django.test import TestCase

from api.models import (
    Account, CaptainVote, Participant, ScoreEntry, SubEvent, ProgramPhase,
    Team, TeamMembership,
)
from api.services import team_merge_service as svc


class TeamMergeTestBase(TestCase):
    def _team(self, code, member_count, captain_index=0):
        team = Team.objects.create(
            code=code, name=f"Doi {code}", approval_status=Team.APPROVAL_DRAFT,
        )
        members = []
        for i in range(member_count):
            mssv = f"{code}-{i}"
            participant = Participant.objects.create(
                mssv=mssv, full_name=f"TV {mssv}", email=f"{mssv}@example.com".lower(),
            )
            TeamMembership.objects.create(
                team=team, participant=participant, is_captain=(i == captain_index),
            )
            members.append(participant)
        return team, members

    def _mssvs(self, team):
        return sorted(
            TeamMembership.objects.filter(team=team)
            .values_list("participant__mssv", flat=True)
        )


class MergeRulesTests(TeamMergeTestBase):
    def test_two_under_strength_teams_merge(self):
        source, _ = self._team("T0001", 2)
        target, _ = self._team("T0002", 3)

        self.assertIsNone(svc.can_merge(source, target))
        merged = svc.merge_teams(source, target)

        self.assertEqual(merged.code, "T0002")
        self.assertEqual(TeamMembership.objects.filter(team=merged).count(), 5)
        self.assertFalse(Team.objects.filter(code="T0001").exists())

    def test_the_merged_team_is_named_after_its_code(self):
        source, _ = self._team("T0010", 2)
        target, _ = self._team("T0011", 2)

        merged = svc.merge_teams(source, target)

        self.assertEqual(merged.name, "T0011")

    def test_the_merged_team_has_no_captain(self):
        """Neither original captain has a claim on the other half's members."""
        source, _ = self._team("T0020", 2)
        target, _ = self._team("T0021", 3)

        merged = svc.merge_teams(source, target)

        self.assertFalse(svc.has_captain(merged))
        self.assertEqual(
            TeamMembership.objects.filter(team=merged, is_captain=True).count(), 0,
        )

    def test_a_merge_that_would_overflow_is_refused(self):
        source, _ = self._team("T0030", 3)
        target, _ = self._team("T0031", 3)

        self.assertEqual(svc.can_merge(source, target), "merge_would_exceed_max:5")

    def test_a_team_cannot_merge_into_itself(self):
        team, _ = self._team("T0040", 2)

        self.assertEqual(svc.can_merge(team, team), "merge_same_team")

    def test_a_team_with_results_is_refused(self):
        """Scores are recorded against a team code; folding it away strands them."""
        source, _ = self._team("T0050", 2)
        target, _ = self._team("T0051", 2)
        phase = ProgramPhase.objects.create(key="qualifying", label="Q", order=1)
        event = SubEvent.objects.create(phase=phase, name="Su kien")
        ScoreEntry.objects.create(team=source, phase=phase, sub_event=event, points=10)

        self.assertEqual(svc.can_merge(source, target), "merge_team_has_history:T0050")

    def test_an_approved_team_may_still_be_merged(self):
        source, _ = self._team("T0060", 2)
        target, _ = self._team("T0061", 2)
        for team in (source, target):
            team.approval_status = Team.APPROVAL_APPROVED
            team.save(update_fields=["approval_status"])

        self.assertIsNone(svc.can_merge(source, target))

    def test_every_member_survives_the_merge(self):
        source, _ = self._team("T0070", 2)
        target, _ = self._team("T0071", 2)
        expected = sorted(self._mssvs(source) + self._mssvs(target))

        merged = svc.merge_teams(source, target)

        self.assertEqual(self._mssvs(merged), expected)


class CaptainBallotTests(TeamMergeTestBase):
    def setUp(self):
        source, self.source_members = self._team("T0100", 2)
        target, self.target_members = self._team("T0101", 3)
        self.team = svc.merge_teams(source, target)
        self.members = self.source_members + self.target_members

    def _all_vote_for(self, candidate, skip=0):
        for voter in self.members[skip:]:
            self.assertIsNone(svc.cast_vote(self.team, voter, candidate))
        svc.resolve_election(self.team)

    def test_the_winner_becomes_captain(self):
        winner = self.members[1]

        self._all_vote_for(winner)

        membership = TeamMembership.objects.get(team=self.team, participant=winner)
        self.assertTrue(membership.is_captain)
        self.assertEqual(
            TeamMembership.objects.filter(team=self.team, is_captain=True).count(), 1,
        )

    def test_the_ballot_stays_open_until_everyone_has_voted(self):
        self._all_vote_for(self.members[0], skip=1)

        self.assertFalse(svc.has_captain(self.team))

    def test_a_tie_leaves_the_ballot_open(self):
        """Picking arbitrarily would be worse than letting someone switch."""
        svc.cast_vote(self.team, self.members[0], self.members[0])
        svc.cast_vote(self.team, self.members[1], self.members[0])
        svc.cast_vote(self.team, self.members[2], self.members[2])
        svc.cast_vote(self.team, self.members[3], self.members[2])
        svc.cast_vote(self.team, self.members[4], self.members[4])
        svc.resolve_election(self.team)

        self.assertFalse(svc.has_captain(self.team))

    def test_changing_a_vote_replaces_it_rather_than_adding_one(self):
        svc.cast_vote(self.team, self.members[0], self.members[1])
        svc.cast_vote(self.team, self.members[0], self.members[2])

        self.assertEqual(
            CaptainVote.objects.filter(team=self.team, voter=self.members[0]).count(), 1,
        )
        self.assertEqual(svc.tally(self.team)["votes_cast"], 1)

    def test_switching_a_vote_can_break_a_tie(self):
        svc.cast_vote(self.team, self.members[0], self.members[0])
        svc.cast_vote(self.team, self.members[1], self.members[0])
        svc.cast_vote(self.team, self.members[2], self.members[2])
        svc.cast_vote(self.team, self.members[3], self.members[2])
        svc.cast_vote(self.team, self.members[4], self.members[4])
        svc.resolve_election(self.team)
        self.assertFalse(svc.has_captain(self.team))

        svc.cast_vote(self.team, self.members[4], self.members[0])
        svc.resolve_election(self.team)

        self.assertTrue(
            TeamMembership.objects.get(
                team=self.team, participant=self.members[0],
            ).is_captain,
        )

    def test_an_outsider_cannot_vote(self):
        other_team, other_members = self._team("T0200", 1)

        error = svc.cast_vote(self.team, other_members[0], self.members[0])

        self.assertEqual(error, "not_a_team_member")

    def test_a_candidate_must_be_on_the_team(self):
        _, outsiders = self._team("T0201", 1)

        error = svc.cast_vote(self.team, self.members[0], outsiders[0])

        self.assertEqual(error, "candidate_not_in_team")

    def test_voting_stops_once_a_captain_exists(self):
        self._all_vote_for(self.members[0])

        error = svc.cast_vote(self.team, self.members[1], self.members[1])

        self.assertEqual(error, "captain_already_elected")

    def test_ballots_are_discarded_once_the_election_resolves(self):
        self._all_vote_for(self.members[0])

        self.assertFalse(CaptainVote.objects.filter(team=self.team).exists())

    def test_only_the_captain_may_rename_the_team(self):
        self._all_vote_for(self.members[3])

        self.assertTrue(svc.may_rename(self.team, self.members[3]))
        for other in self.members:
            if other.id != self.members[3].id:
                self.assertFalse(svc.may_rename(self.team, other))

    def test_nobody_may_rename_a_leaderless_team(self):
        for member in self.members:
            self.assertFalse(svc.may_rename(self.team, member))
