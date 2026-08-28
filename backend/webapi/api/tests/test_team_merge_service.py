"""Merging under-strength teams, and the captain ballot that follows."""

import json
from unittest.mock import patch

from django.test import TestCase
from django.db.models.query import QuerySet

from api.models import (
    Account, CaptainVote, Participant, ScoreEntry, SubEvent, ProgramPhase,
    Team, TeamMembership,
)
from api.services import team_merge_service as svc
from api.services.auth_service import generate_session
from api.services.team_service import add_member


class TeamMergeTestBase(TestCase):
    def setUp(self):
        ProgramPhase.objects.create(
            key="registration", label="Dang ky", order=0, is_current=True,
        )

    def _team(
        self,
        code,
        member_count,
        captain_index=0,
        approval_status=Team.APPROVAL_APPROVED,
    ):
        team = Team.objects.create(
            code=code, name=f"Doi {code}", approval_status=approval_status,
        )
        members = []
        for i in range(member_count):
            mssv = f"{code}-{i}"
            participant = Participant.objects.create(
                mssv=mssv, full_name=f"TV {mssv}", email=f"{mssv}@example.com".lower(),
                extra={"gender": "male" if i % 2 == 0 else "female"},
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
    def test_member_add_cannot_overfill_team_during_merge(self):
        target, _ = self._team("T0000", 3)
        source, _ = self._team("T0009", 2)
        original_count = QuerySet.count
        original_select_for_update = QuerySet.select_for_update
        merge_triggered = False
        team_locked = False
        merge_error = None

        def track_team_lock(queryset, *args, **kwargs):
            nonlocal team_locked
            if queryset.model is Team:
                team_locked = True
            return original_select_for_update(queryset, *args, **kwargs)

        def count_with_interleaved_merge(queryset):
            nonlocal merge_triggered, merge_error
            count = original_count(queryset)
            if not merge_triggered and not team_locked and queryset.model is TeamMembership:
                merge_triggered = True
                merged, merge_error, _ = svc.merge_team_group([target.code, source.code])
                self.assertIsNone(merge_error)
                self.assertEqual(merged.code, target.code)
            return count

        with (
            patch.object(QuerySet, "select_for_update", track_team_lock),
            patch.object(QuerySet, "count", count_with_interleaved_merge),
        ):
            participant, error = add_member(
                target,
                "NEW-MEMBER",
                full_name="New member",
                email="new-member@example.com",
            )

        if not merge_triggered:
            _, merge_error, _ = svc.merge_team_group([target.code, source.code])

        self.assertIsNotNone(participant)
        self.assertIsNone(error)
        self.assertEqual(merge_error, "merge_would_exceed_max:5")
        self.assertEqual(TeamMembership.objects.filter(team=target).count(), 4)
        self.assertTrue(Team.objects.filter(code=source.code).exists())

    def test_three_teams_can_merge_in_one_operation(self):
        first, first_members = self._team("T0001", 1)
        second, second_members = self._team("T0002", 2)
        third, third_members = self._team("T0003", 2)

        merged, error, removed = svc.merge_team_group([
            third.code, first.code, second.code,
        ])

        self.assertIsNone(error)
        self.assertEqual(merged.code, "T0001")
        self.assertEqual(removed, ["T0002", "T0003"])
        self.assertEqual(
            self._mssvs(merged),
            sorted(
                [member.mssv for member in first_members]
                + [member.mssv for member in second_members]
                + [member.mssv for member in third_members]
            ),
        )
        self.assertFalse(Team.objects.filter(code__in=["T0002", "T0003"]).exists())

    def test_multi_team_merge_does_not_require_a_full_roster(self):
        first, _ = self._team("T0004", 1)
        second, _ = self._team("T0005", 2)

        merged, error, _ = svc.merge_team_group([first.code, second.code])

        self.assertIsNone(error)
        self.assertEqual(TeamMembership.objects.filter(team=merged).count(), 3)

    def test_multi_team_merge_refuses_a_roster_over_maximum(self):
        first, _ = self._team("T0006", 2)
        second, _ = self._team("T0007", 2)
        third, _ = self._team("T0008", 2)

        merged, error, _ = svc.merge_team_group([
            first.code, second.code, third.code,
        ])

        self.assertIsNone(merged)
        self.assertEqual(error, "merge_would_exceed_max:5")
        self.assertEqual(Team.objects.filter(code__in=["T0006", "T0007", "T0008"]).count(), 3)

    def test_merge_refuses_every_unapproved_status(self):
        for index, status in enumerate((Team.APPROVAL_DRAFT, Team.APPROVAL_PENDING)):
            with self.subTest(status=status):
                approved, _ = self._team(f"T008{index * 2}", 1)
                blocked, _ = self._team(
                    f"T008{index * 2 + 1}", 1, approval_status=status,
                )

                merged, error, _ = svc.merge_team_group([approved.code, blocked.code])

                self.assertIsNone(merged)
                self.assertEqual(error, f"merge_team_not_approved:{blocked.code}")
                self.assertTrue(Team.objects.filter(pk=approved.pk).exists())
                self.assertTrue(Team.objects.filter(pk=blocked.pk).exists())

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
        super().setUp()
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

    def test_a_supermajority_ends_the_ballot_early(self):
        # 3 out of 5 is a supermajority, so the winner is declared immediately
        # even without the last 2 votes.
        self._all_vote_for(self.members[0], skip=2)
        
        self.assertTrue(svc.has_captain(self.team))

    def test_the_ballot_stays_open_until_everyone_has_voted_if_no_supermajority(self):
        # 4 votes cast, but no one has 3 votes (2 for member[0], 2 for member[1]).
        # The ballot must wait for the 5th vote.
        svc.cast_vote(self.team, self.members[0], self.members[0])
        svc.cast_vote(self.team, self.members[1], self.members[0])
        svc.cast_vote(self.team, self.members[2], self.members[1])
        svc.cast_vote(self.team, self.members[3], self.members[1])
        
        svc.resolve_election(self.team)
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


class MergeTeamsApiTests(TeamMergeTestBase):
    def setUp(self):
        super().setUp()
        self.admin = Account.objects.create(
            username="merge-admin",
            email="merge-admin@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.token = generate_session(self.admin)

    def _auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def test_admin_can_merge_multiple_selected_teams(self):
        first, _ = self._team("T0300", 1)
        second, _ = self._team("T0301", 1)
        third, _ = self._team("T0302", 2)

        response = self.client.post(
            "/api/admin/teams/merge",
            data=json.dumps({"team_codes": [third.code, first.code, second.code]}),
            content_type="application/json",
            **self._auth(),
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["code"], "T0300")
        self.assertEqual(body["merged_from"], ["T0301", "T0302"])
        self.assertEqual(body["member_count"], 4)

    def test_team_list_exposes_member_names_and_gender_for_merging(self):
        team, _ = self._team("T0303", 3)

        response = self.client.get(
            "/api/teams?approval_status=approved",
            **self._auth(),
        )

        self.assertEqual(response.status_code, 200)
        item = next(entry for entry in response.json()["items"] if entry["code"] == team.code)
        self.assertEqual(
            item["gender_counts"],
            {"male": 2, "female": 1, "other": 0, "unknown": 0},
        )
        self.assertEqual(len(item["member_summaries"]), 3)
        self.assertEqual(
            {member["gender"] for member in item["member_summaries"]},
            {"male", "female"},
        )

    def test_api_rejects_a_selection_over_maximum(self):
        first, _ = self._team("T0310", 3)
        second, _ = self._team("T0311", 3)

        response = self.client.post(
            "/api/admin/teams/merge",
            data=json.dumps({"team_codes": [first.code, second.code]}),
            content_type="application/json",
            **self._auth(),
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "merge_would_exceed_max:5")

    def test_draft_team_cannot_be_approved(self):
        draft, _ = self._team(
            "T0314", 1, approval_status=Team.APPROVAL_DRAFT,
        )

        response = self.client.post(
            f"/api/teams/{draft.code}/approve",
            data=json.dumps({}),
            content_type="application/json",
            **self._auth(),
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "team_not_submitted")
        draft.refresh_from_db()
        self.assertEqual(draft.approval_status, Team.APPROVAL_DRAFT)

    def test_patch_cannot_bypass_submission_before_approval(self):
        draft, _ = self._team(
            "T0316", 1, approval_status=Team.APPROVAL_DRAFT,
        )

        response = self.client.patch(
            f"/api/teams/{draft.code}",
            data=json.dumps({"approval_status": Team.APPROVAL_APPROVED}),
            content_type="application/json",
            **self._auth(),
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "team_not_submitted")
        draft.refresh_from_db()
        self.assertEqual(draft.approval_status, Team.APPROVAL_DRAFT)

    def test_submitted_team_can_be_approved(self):
        submitted, _ = self._team(
            "T0315", 1, approval_status=Team.APPROVAL_PENDING,
        )

        response = self.client.post(
            f"/api/teams/{submitted.code}/approve",
            data=json.dumps({}),
            content_type="application/json",
            **self._auth(),
        )

        self.assertEqual(response.status_code, 200)
        submitted.refresh_from_db()
        self.assertEqual(submitted.approval_status, Team.APPROVAL_APPROVED)

    def test_api_rejects_merge_after_registration_phase(self):
        first, _ = self._team("T0312", 1)
        second, _ = self._team("T0313", 1)
        ProgramPhase.objects.filter(key="registration").update(is_current=False)
        ProgramPhase.objects.create(
            key="qualifying", label="Vong loai", order=1, is_current=True,
        )

        response = self.client.post(
            "/api/admin/teams/merge",
            data=json.dumps({"team_codes": [first.code, second.code]}),
            content_type="application/json",
            **self._auth(),
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "registration_phase_closed")
        self.assertEqual(Team.objects.filter(code__in=[first.code, second.code]).count(), 2)

    def test_stale_overlapping_admin_merge_fails_without_partial_changes(self):
        first, _ = self._team("T0320", 1)
        shared, _ = self._team("T0321", 1)
        untouched, _ = self._team("T0322", 1)

        winner = self.client.post(
            "/api/admin/teams/merge",
            data=json.dumps({"team_codes": [first.code, shared.code]}),
            content_type="application/json",
            **self._auth(),
        )
        stale = self.client.post(
            "/api/admin/teams/merge",
            data=json.dumps({"team_codes": [shared.code, untouched.code]}),
            content_type="application/json",
            **self._auth(),
        )

        self.assertEqual(winner.status_code, 200)
        self.assertEqual(stale.status_code, 404)
        self.assertEqual(stale.json()["error"], "not_found")
        self.assertEqual(TeamMembership.objects.filter(team=first).count(), 2)
        self.assertEqual(TeamMembership.objects.filter(team=untouched).count(), 1)
        self.assertTrue(Team.objects.filter(code=untouched.code).exists())
