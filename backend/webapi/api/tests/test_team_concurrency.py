"""PostgreSQL regression tests for competing team-registration writes."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.db import close_old_connections
from django.test import Client, TransactionTestCase, skipUnlessDBFeature

from api.models import Account, Participant, SystemSetting, Team, TeamMembership
from api.services.auth_service import generate_session
from api.services.team_service import add_member, create_team


@skipUnlessDBFeature("has_select_for_update")
class TeamConcurrencyTests(TransactionTestCase):
    def _account(self, suffix: str) -> Account:
        return Account.objects.create(
            username=f"race-{suffix}",
            email=f"race-{suffix}@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv=f"RACE-{suffix}",
            full_name=f"Race {suffix}",
        )

    def _solo_team(self, account: Account) -> Team:
        team, error = create_team(
            f"Pending team {account.mssv}", owner_account=account,
        )
        self.assertIsNone(error)
        participant, error = add_member(
            team,
            account.mssv,
            full_name=account.full_name,
            email=account.email,
            is_captain=True,
            actor=account,
        )
        self.assertIsNone(error)
        self.assertIsNotNone(participant)
        return team

    def test_simultaneous_create_requests_leave_one_complete_team(self):
        SystemSetting.objects.create(key="registration_open", value=True)
        account = self._account("CREATE")
        Participant.objects.create(
            account=account,
            mssv=account.mssv,
            full_name=account.full_name,
            email=account.email,
        )
        token = generate_session(account)
        barrier = Barrier(2)

        def create_from_request():
            close_old_connections()
            try:
                client = Client()
                barrier.wait(timeout=5)
                response = client.post(
                    "/api/my-team",
                    data={},
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Bearer {token}",
                )
                return response.status_code, response.json().get("error")
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: create_from_request(), range(2)))

        self.assertEqual(sorted(status for status, _ in results), [201, 409])
        self.assertEqual(
            [error for status, error in results if status == 409],
            ["already_has_team"],
        )
        self.assertEqual(Team.objects.filter(owner_account=account).count(), 1)
        self.assertEqual(
            TeamMembership.objects.filter(participant__mssv=account.mssv).count(),
            1,
        )

    def test_two_captains_competing_for_same_member_have_one_winner(self):
        captain_a = self._account("A")
        captain_c = self._account("C")
        member_b = self._account("B")
        team_a = self._solo_team(captain_a)
        team_c = self._solo_team(captain_c)
        shell_b = self._solo_team(member_b)
        barrier = Barrier(2)

        def add_to_team(team_id: int, actor_id: int):
            close_old_connections()
            try:
                target = Team.objects.get(pk=team_id)
                actor = Account.objects.get(pk=actor_id)
                barrier.wait(timeout=5)
                participant, error = add_member(
                    target,
                    member_b.mssv,
                    full_name=member_b.full_name,
                    email=member_b.email,
                    actor=actor,
                )
                return team_id, participant is not None, error
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(add_to_team, team_a.id, captain_a.id),
                pool.submit(add_to_team, team_c.id, captain_c.id),
            ]
            results = [future.result(timeout=10) for future in futures]

        winners = [team_id for team_id, added, error in results if added and error is None]
        losers = [error for _, added, error in results if not added]
        self.assertEqual(len(winners), 1)
        self.assertEqual(losers, ["mssv_in_other_team"])
        membership = TeamMembership.objects.get(participant__mssv=member_b.mssv)
        self.assertEqual(membership.team_id, winners[0])
        self.assertFalse(membership.is_captain)
        self.assertFalse(Team.objects.filter(pk=shell_b.pk).exists())

    def test_member_creating_team_while_captain_adds_them_leaves_no_orphan(self):
        SystemSetting.objects.create(key="registration_open", value=True)
        captain_a = self._account("EXACT-A")
        member_b = self._account("EXACT-B")
        team_a = self._solo_team(captain_a)
        Participant.objects.create(
            account=member_b,
            mssv=member_b.mssv,
            full_name=member_b.full_name,
            email=member_b.email,
        )
        token_b = generate_session(member_b)
        barrier = Barrier(2)

        def b_creates_team():
            close_old_connections()
            try:
                client = Client()
                barrier.wait(timeout=5)
                response = client.post(
                    "/api/my-team",
                    data={},
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Bearer {token_b}",
                )
                return response.status_code
            finally:
                close_old_connections()

        def a_adds_b():
            close_old_connections()
            try:
                target = Team.objects.get(pk=team_a.pk)
                actor = Account.objects.get(pk=captain_a.pk)
                barrier.wait(timeout=5)
                participant, error = add_member(
                    target,
                    member_b.mssv,
                    full_name=member_b.full_name,
                    email=member_b.email,
                    actor=actor,
                )
                return participant is not None, error
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            create_future = pool.submit(b_creates_team)
            add_future = pool.submit(a_adds_b)
            create_status = create_future.result(timeout=10)
            added, add_error = add_future.result(timeout=10)

        self.assertIn(create_status, [201, 409])
        self.assertTrue(added)
        self.assertIsNone(add_error)
        membership = TeamMembership.objects.get(participant__mssv=member_b.mssv)
        self.assertEqual(membership.team_id, team_a.id)
        self.assertEqual(Team.objects.filter(owner_account=member_b).count(), 0)

    def test_two_members_competing_for_last_slot_do_not_exceed_capacity(self):
        SystemSetting.objects.create(key="team_max_members", value=2)
        captain = self._account("CAPACITY-A")
        team = self._solo_team(captain)
        candidates = [
            Participant.objects.create(
                mssv=f"RACE-CAPACITY-{suffix}",
                full_name=f"Candidate {suffix}",
                email=f"candidate-{suffix}@example.com",
            )
            for suffix in ("B", "C")
        ]
        barrier = Barrier(2)

        def add_candidate(participant_id: int):
            close_old_connections()
            try:
                target = Team.objects.get(pk=team.pk)
                actor = Account.objects.get(pk=captain.pk)
                candidate = Participant.objects.get(pk=participant_id)
                barrier.wait(timeout=5)
                added, error = add_member(
                    target,
                    candidate.mssv,
                    full_name=candidate.full_name,
                    email=candidate.email,
                    actor=actor,
                )
                return added is not None, error
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(add_candidate, [item.id for item in candidates]))

        self.assertEqual(sum(1 for added, _ in results if added), 1)
        self.assertEqual([error for added, error in results if not added], ["team_full"])
        self.assertEqual(TeamMembership.objects.filter(team=team).count(), 2)
