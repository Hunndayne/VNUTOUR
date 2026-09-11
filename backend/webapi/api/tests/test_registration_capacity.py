"""The event cap applies to newly counted members across every registration path."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections
from django.test import Client, TestCase, TransactionTestCase, skipUnlessDBFeature
from django.utils import timezone

from api.models import Account, Participant, ProgramPhase, Team, TeamMembership
from api.services.auth_service import generate_session
from api.services.registration_service import register_individual, register_team
from api.services.team_invite_service import issue_team_invite
from api.services.team_service import get_current_registrations, set_max_registrations, set_registration_open
from api.tests.test_registration_service import person


class CapacityFixtures:
    def setUp(self):
        super().setUp()
        set_registration_open(True)
        set_max_registrations(2)
        for helper in ("send_registration_received_team", "send_registration_received_individual"):
            mock = patch(f"api.services.registration_emails.{helper}")
            mock.start()
            self.addCleanup(mock.stop)

    def participant(self, mssv, account=None):
        data = person(mssv)
        gender = data.pop("gender")
        return Participant.objects.create(**data, extra={"gender": gender}, account=account)

    def team(self, code, status=Team.APPROVAL_DRAFT, size=1):
        mssv = f"{code}CAP"
        account = Account.objects.create(
            username=mssv, email=person(mssv)["email"], password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv=mssv,
        )
        team = Team.objects.create(
            code=code, name=f"Pending team {mssv}", owner_account=account,
            approval_status=status, roster_locked_at=timezone.now(),
            payment_proof_file={"name": "fixture.png", "key": "fixture.png", "storage": "local"},
        )
        TeamMembership.objects.create(team=team, participant=self.participant(mssv, account), is_captain=True)
        for index in range(1, size):
            TeamMembership.objects.create(team=team, participant=self.participant(f"{code}M{index}"))
        return team, account

    def submit(self, account):
        return Client().post(
            "/api/my-team/submit", data={}, content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(account)}",
        )

    def assert_capacity_error(self, response):
        self.assertIn(response.status_code, (400, 403, 409))
        self.assertEqual(response.json()["error"], "registration_capacity_reached")


class RegistrationCapacityTests(CapacityFixtures, TestCase):
    def test_draft_member_add_checks_the_entire_proposed_roster(self):
        set_max_registrations(3)
        self.team("T0001", Team.APPROVAL_APPROVED)
        draft, account = self.team("T0002")
        draft.roster_locked_at = None
        draft.save(update_fields=["roster_locked_at"])
        auth = {"HTTP_AUTHORIZATION": f"Bearer {generate_session(account)}"}
        fits = self.client.post(
            "/api/my-team/members", data=person("EXTRA1"), content_type="application/json", **auth,
        )
        self.assertEqual(fits.status_code, 201)
        exceeds = self.client.post(
            "/api/my-team/members", data=person("EXTRA2"), content_type="application/json", **auth,
        )
        self.assert_capacity_error(exceeds)
        self.assertFalse(Participant.objects.filter(mssv="EXTRA2").exists())
        self.assertEqual(draft.memberships.count(), 2)
        self.assertEqual(get_current_registrations(), 1)  # Drafts do not reserve slots.

    def test_draft_invite_cannot_join_when_whole_roster_would_not_fit(self):
        self.team("T0001", Team.APPROVAL_PENDING)
        draft, captain = self.team("T0002")
        draft.roster_locked_at = None
        draft.save(update_fields=["roster_locked_at"])
        _, raw_token = issue_team_invite(draft, captain)
        invitee = Account.objects.create(
            username="INVITEE", mssv="INVITEE", email=person("INVITEE")["email"],
            role=Account.ROLE_PARTICIPANT, password_hash="x",
        )
        self.participant("INVITEE", invitee)
        response = self.client.post(
            f"/api/team-invites/{raw_token}", data={}, content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(invitee)}",
        )
        self.assert_capacity_error(response)
        self.assertFalse(TeamMembership.objects.filter(participant__mssv="INVITEE").exists())

    def test_initial_captain_attachment_is_blocked_when_full(self):
        self.team("T0001", Team.APPROVAL_PENDING, size=2)
        account = Account.objects.create(
            username="NEWCAP", mssv="NEWCAP", email=person("NEWCAP")["email"],
            role=Account.ROLE_PARTICIPANT, password_hash="x",
        )
        response = self.client.post(
            "/api/my-team", data={}, content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(account)}",
        )
        self.assert_capacity_error(response)
        self.assertEqual(Team.objects.count(), 1)
        self.assertFalse(TeamMembership.objects.filter(participant__mssv="NEWCAP").exists())

    def test_payment_withholds_qr_for_locked_draft_when_insufficient_slots(self):
        self.team("T0001", Team.APPROVAL_PENDING)
        draft, account = self.team("T0002", size=2)
        response = self.client.get(
            "/api/my-team/payment", HTTP_AUTHORIZATION=f"Bearer {generate_session(account)}",
        )
        self.assert_capacity_error(response)
        for field in ("qr_image_url", "bank", "content", "payment_code"):
            self.assertNotIn(field, response.json())
        self.assertTrue(response.json()["has_proof"])
        self.assertTrue(response.json()["roster_locked"])
        draft.refresh_from_db()
        self.assertIsNone(draft.payment_code)

    def test_payment_rechecks_capacity_after_qr_was_already_shown(self):
        _, account = self.team("T0001", size=2)
        auth = {"HTTP_AUTHORIZATION": f"Bearer {generate_session(account)}"}
        available = self.client.get("/api/my-team/payment", **auth)
        self.assertEqual(available.status_code, 200)
        self.assertTrue(available.json()["qr_image_url"])
        other, _ = self.team("T0002", Team.APPROVAL_PENDING)
        blocked = self.client.get("/api/my-team/payment", **auth)
        self.assert_capacity_error(blocked)
        self.assertNotIn("qr_image_url", blocked.json())
        other.delete()
        reopened = self.client.get("/api/my-team/payment", **auth)
        self.assertEqual(reopened.status_code, 200)
        self.assertEqual(reopened.json()["payment_code"], available.json()["payment_code"])

    def test_counted_teams_keep_payment_access_when_cap_is_exceeded(self):
        set_max_registrations(1)
        for index, status in enumerate((Team.APPROVAL_PENDING, Team.APPROVAL_APPROVED, Team.APPROVAL_REJECTED)):
            with self.subTest(status=status):
                _, account = self.team(f"T000{index}", status, size=2)
                response = self.client.get(
                    "/api/my-team/payment", HTTP_AUTHORIZATION=f"Bearer {generate_session(account)}",
                )
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["qr_image_url"])

    def test_cannot_confirm_roster_for_payment_when_insufficient_slots(self):
        self.team("T0001", Team.APPROVAL_PENDING, size=2)
        draft, account = self.team("T0002")
        draft.roster_locked_at = None
        draft.save(update_fields=["roster_locked_at"])
        response = self.client.patch(
            "/api/my-team", data={"roster_locked": True}, content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(account)}",
        )
        self.assert_capacity_error(response)
        draft.refresh_from_db()
        self.assertIsNone(draft.roster_locked_at)

    def test_dashboard_cannot_submit_when_full(self):
        self.team("T0001", Team.APPROVAL_PENDING, size=2)
        draft, account = self.team("T0002")
        self.assert_capacity_error(self.submit(account))
        draft.refresh_from_db()
        self.assertEqual(draft.approval_status, Team.APPROVAL_DRAFT)
        self.assertIsNone(draft.submitted_at)
        self.assertEqual(get_current_registrations(), 2)

    def test_dashboard_checks_whole_roster_and_accepts_exact_fit(self):
        self.team("T0001", Team.APPROVAL_APPROVED)
        draft, account = self.team("T0002", size=2)
        self.assert_capacity_error(self.submit(account))
        self.assertEqual(get_current_registrations(), 1)
        set_max_registrations(3)
        self.assertEqual(self.submit(account).status_code, 200)
        self.assertEqual(get_current_registrations(), 3)

    def test_existing_teamless_profiles_still_need_slots(self):
        for mssv in ("EXIST1", "EXIST2", "EXIST3"):
            _, error = register_individual(person(mssv))
            self.assertIsNone(error)
        self.team("T0001", Team.APPROVAL_PENDING, size=2)
        response = self.client.post(
            "/api/register/team", content_type="application/json",
            data={"captain": person("EXIST1"), "members": [person("EXIST2"), person("EXIST3")]},
        )
        self.assert_capacity_error(response)
        self.assertEqual(get_current_registrations(), 2)
        self.assertEqual(Team.objects.count(), 1)
        self.assertFalse(TeamMembership.objects.filter(participant__mssv__startswith="EXIST").exists())

    def test_public_registration_checks_existing_and_new_profiles_together(self):
        self.participant("EXIST1")
        self.team("T0001", Team.APPROVAL_PENDING)
        team, error = register_team({"captain": person("EXIST1"), "members": [person("NEW1")]})
        self.assertIsNone(team)
        self.assertEqual(error, "registration_capacity_reached")
        self.assertFalse(Participant.objects.filter(mssv="NEW1").exists())

    def test_rejected_team_can_resubmit_even_if_limit_was_lowered(self):
        self.team("T0001", Team.APPROVAL_APPROVED)
        _, account = self.team("T0002", Team.APPROVAL_REJECTED)
        set_max_registrations(1)
        self.assertEqual(self.submit(account).status_code, 200)
        self.assertEqual(get_current_registrations(), 2)

    def test_adding_to_rejected_team_checks_capacity_before_creating_profile(self):
        rejected, account = self.team("T0001", Team.APPROVAL_REJECTED, size=2)
        rejected.roster_locked_at = None
        rejected.save(update_fields=["roster_locked_at"])
        response = self.client.post(
            "/api/my-team/members", data=person("EXTRA1"), content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(account)}",
        )
        self.assert_capacity_error(response)
        self.assertFalse(Participant.objects.filter(mssv="EXTRA1").exists())
        self.assertEqual(get_current_registrations(), 2)

    def test_invite_into_rejected_team_cannot_exceed_capacity(self):
        rejected, captain = self.team("T0001", Team.APPROVAL_REJECTED, size=2)
        rejected.roster_locked_at = None
        rejected.save(update_fields=["roster_locked_at"])
        _, raw_token = issue_team_invite(rejected, captain)
        account = Account.objects.create(
            username="INVITEE", email=person("INVITEE")["email"], mssv="INVITEE",
            role=Account.ROLE_PARTICIPANT, password_hash="x",
        )
        self.participant("INVITEE", account)
        response = self.client.post(
            f"/api/team-invites/{raw_token}", data={}, content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(account)}",
        )
        self.assert_capacity_error(response)
        self.assertFalse(TeamMembership.objects.filter(participant__mssv="INVITEE").exists())

    def test_admin_status_update_cannot_bypass_capacity(self):
        ProgramPhase.objects.create(key="registration", label="Registration", order=1, is_current=True)
        self.team("T0001", Team.APPROVAL_PENDING, size=2)
        draft, _ = self.team("T0002")
        admin = Account.objects.create(username="admin", role=Account.ROLE_ADMIN, password_hash="x")
        response = self.client.patch(
            f"/api/teams/{draft.code}", data={"approval_status": Team.APPROVAL_PENDING},
            content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {generate_session(admin)}",
        )
        self.assert_capacity_error(response)
        self.assertEqual(get_current_registrations(), 2)

    def test_zero_limit_allows_dashboard_submission(self):
        set_max_registrations(0)
        _, account = self.team("T0001", size=2)
        self.assertEqual(self.submit(account).status_code, 200)

    def test_existing_profiles_can_fill_exact_remaining_capacity(self):
        self.participant("EXIST1")
        self.team("T0001", Team.APPROVAL_REJECTED)
        team, error = register_team({"captain": person("EXIST1"), "members": []})
        self.assertIsNone(error)
        self.assertIsNotNone(team)
        self.assertEqual(get_current_registrations(), 2)

    def test_rejected_team_can_add_member_up_to_limit_then_resubmit(self):
        rejected, account = self.team("T0001", Team.APPROVAL_REJECTED)
        rejected.roster_locked_at = None
        rejected.save(update_fields=["roster_locked_at"])
        response = self.client.post(
            "/api/my-team/members", data=person("EXTRA1"), content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(account)}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(get_current_registrations(), 2)
        rejected.roster_locked_at = timezone.now()
        rejected.save(update_fields=["roster_locked_at"])
        self.assertEqual(self.submit(account).status_code, 200)
        self.assertEqual(get_current_registrations(), 2)

    def test_admin_cannot_create_approved_team_with_owner_when_full(self):
        self.team("T0001", Team.APPROVAL_APPROVED, size=2)
        admin = Account.objects.create(username="admin", role=Account.ROLE_ADMIN, password_hash="x")
        Account.objects.create(
            username="EXTRA1", mssv="EXTRA1", email=person("EXTRA1")["email"],
            role=Account.ROLE_PARTICIPANT, password_hash="x",
        )
        response = self.client.post(
            "/api/teams", data={"name": "New team", "owner_username": "EXTRA1"},
            content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {generate_session(admin)}",
        )
        self.assert_capacity_error(response)
        self.assertEqual(Team.objects.count(), 1)
        self.assertFalse(Participant.objects.filter(mssv="EXTRA1").exists())


@skipUnlessDBFeature("has_select_for_update")
class RegistrationCapacityConcurrencyTests(CapacityFixtures, TransactionTestCase):
    def race(self, operations):
        barrier = Barrier(len(operations))

        def run(operation):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return operation()
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            return list(pool.map(run, operations))

    def test_two_drafts_compete_for_last_event_slot(self):
        set_max_registrations(1)
        _, first = self.team("T0001")
        _, second = self.team("T0002")
        responses = self.race([lambda: self.submit(first), lambda: self.submit(second)])
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        self.assertEqual(get_current_registrations(), 1)

    def test_public_registration_and_dashboard_share_last_slot(self):
        set_max_registrations(1)
        _, account = self.team("T0001")
        responses = self.race([
            lambda: self.submit(account),
            lambda: Client().post("/api/register/team", data={"captain": person("PUBLIC1"), "members": []}, content_type="application/json"),
        ])
        self.assertEqual(sum(response.status_code in (200, 201) for response in responses), 1)
        self.assertEqual(get_current_registrations(), 1)
        loser = next(response for response in responses if response.status_code >= 400)
        self.assert_capacity_error(loser)

    def test_two_public_teams_compete_for_last_slot_with_existing_profiles(self):
        set_max_registrations(1)
        self.participant("PUBLIC1")
        self.participant("PUBLIC2")

        def register(mssv):
            return Client().post(
                "/api/register/team", data={"captain": person(mssv), "members": []},
                content_type="application/json",
            )

        responses = self.race([lambda: register("PUBLIC1"), lambda: register("PUBLIC2")])
        self.assertEqual(sorted(response.status_code for response in responses), [201, 403])
        self.assertEqual(get_current_registrations(), 1)

    def test_invite_and_dashboard_compete_for_last_slot(self):
        rejected, captain = self.team("T0001", Team.APPROVAL_REJECTED)
        rejected.roster_locked_at = None
        rejected.save(update_fields=["roster_locked_at"])
        _, raw_token = issue_team_invite(rejected, captain)
        _, draft_captain = self.team("T0002")
        invitee = Account.objects.create(
            username="INVITEE", email=person("INVITEE")["email"], mssv="INVITEE",
            role=Account.ROLE_PARTICIPANT, password_hash="x",
        )
        self.participant("INVITEE", invitee)
        invitee_token = generate_session(invitee)
        responses = self.race([
            lambda: self.submit(draft_captain),
            lambda: Client().post(
                f"/api/team-invites/{raw_token}", data={}, content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {invitee_token}",
            ),
        ])
        self.assertEqual(sum(response.status_code == 200 for response in responses), 1)
        self.assertEqual(get_current_registrations(), 2)
        self.assert_capacity_error(next(response for response in responses if response.status_code >= 400))
