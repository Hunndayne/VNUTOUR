"""Admin identity correction must preserve a person, never claim another roster row."""
import json
from unittest.mock import patch

from django.db import IntegrityError
from django.test import TestCase

from api.models import Account, AuditLog, Participant, Team, TeamMembership
from api.services.auth_service import generate_session
from api.services.team_service import auto_link_participant_by_verified_email


class AdminAccountIdentityTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(username="admin-id", email="admin@identity.test", role="admin")
        self.account = Account.objects.create(
            username="person-id", email="person@identity.test", mssv="OLD001", full_name="Person",
        )
        self.profile = Participant.objects.create(
            account=self.account, mssv="OLD001", email=self.account.email,
            full_name="Person", extra={"keep": "yes"}, discord_id=123456,
        )
        self.team = Team.objects.create(code="ID001", name="Identity team")
        self.membership = TeamMembership.objects.create(
            participant=self.profile, team=self.team, is_captain=True,
        )
        self.admin_auth = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(self.admin)}
        self.user_auth = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(self.account)}

    def edit(self, **data):
        return self.client.patch(
            "/api/admin/accounts/person-id", data=json.dumps(data),
            content_type="application/json", **self.admin_auth,
        )

    def assert_unchanged(self):
        self.account.refresh_from_db()
        self.profile.refresh_from_db()
        self.membership.refresh_from_db()
        self.assertEqual(self.account.mssv, "OLD001")
        self.assertEqual(self.account.email, "person@identity.test")
        self.assertEqual(self.account.full_name, "Person")
        self.assertEqual(self.profile.mssv, "OLD001")
        self.assertEqual(self.profile.account_id, self.account.pk)
        self.assertEqual(self.membership.participant_id, self.profile.pk)
        self.assertEqual(self.membership.team_id, self.team.pk)

    def test_change_and_revert_preserve_profile_team_and_unregistered_teammate(self):
        teammate = Participant.objects.create(mssv="MEMBER1", full_name="No web account", email="member@identity.test")
        TeamMembership.objects.create(team=self.team, participant=teammate)
        for new_mssv in (" new001 ", "OLD001"):
            response = self.edit(mssv=new_mssv)
            self.assertEqual(response.status_code, 200)
            self.profile.refresh_from_db()
            self.assertEqual(self.profile.mssv, new_mssv.strip().upper())
            self.assertEqual(self.profile.extra, {"keep": "yes"})
            self.assertEqual(self.profile.discord_id, 123456)
            self.membership.refresh_from_db()
            self.assertTrue(self.membership.is_captain)
            self.assertEqual(self.membership.participant_id, self.profile.pk)
            self.assertEqual(self.membership.team_id, self.team.pk)
            profile = self.client.get("/api/me/profile", **self.user_auth)
            self.assertEqual(profile.status_code, 200)
            self.assertEqual(profile.json()["profile"]["mssv"], self.profile.mssv)
            team = self.client.get("/api/my-team", **self.user_auth)
            self.assertEqual(team.status_code, 200)
            self.assertEqual(team.json()["team"]["code"], self.team.code)
            members = self.client.get("/api/teams/ID001", **self.admin_auth).json()["members"]
            self.assertTrue(next(m for m in members if m["mssv"] == self.profile.mssv)["has_account"])
            self.assertFalse(next(m for m in members if m["mssv"] == "MEMBER1")["has_account"])
        teammate.refresh_from_db()
        self.assertIsNone(teammate.account_id)
        self.assertEqual(Participant.objects.count(), 2)
        self.assertEqual(AuditLog.objects.filter(action="account.identity_updated").count(), 2)

    def test_new_mssv_of_unregistered_person_is_rejected_even_with_matching_email(self):
        other = Participant.objects.create(mssv="NEW001", full_name="Other", email="other@identity.test")
        other_team = Team.objects.create(code="ID002", name="Other team")
        TeamMembership.objects.create(team=other_team, participant=other)
        response = self.edit(mssv="NEW001", email=other.email, full_name="Changed")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "participant_identity_conflict")
        self.assert_unchanged()
        other.refresh_from_db()
        self.assertIsNone(other.account_id)
        self.assertTrue(TeamMembership.objects.filter(team=other_team, participant=other).exists())

    def test_unregistered_profile_without_team_is_not_absorbed(self):
        other = Participant.objects.create(mssv="NEW001", full_name="Other")
        self.assertEqual(self.edit(mssv="NEW001").status_code, 409)
        self.assert_unchanged()
        self.assertTrue(Participant.objects.filter(pk=other.pk, account__isnull=True).exists())

    def test_existing_account_mssv_is_rejected(self):
        Account.objects.create(username="other-id", email="other@identity.test", mssv="NEW001")
        self.assertEqual(self.edit(mssv="new001", full_name="Changed").status_code, 409)
        self.assert_unchanged()

    def test_profile_email_conflict_rolls_back_all_account_fields(self):
        Participant.objects.create(mssv="OTHER001", full_name="Other", email="other@identity.test")
        self.assertEqual(self.edit(mssv="NEW001", email="other@identity.test", full_name="Changed").status_code, 409)
        self.assert_unchanged()

    def test_database_failure_after_account_save_rolls_back(self):
        with patch.object(Participant, "save", side_effect=IntegrityError("simulated write race")):
            response = self.edit(mssv="NEW001", full_name="Changed")
        self.assertEqual(response.status_code, 409)
        self.assert_unchanged()
        self.assertFalse(AuditLog.objects.filter(action="account.identity_updated").exists())

    def test_linked_profile_mssv_cannot_be_cleared(self):
        self.assertEqual(self.edit(mssv="").status_code, 409)
        self.assert_unchanged()

    def test_existing_mismatch_requires_review_without_automatic_repair(self):
        Account.objects.filter(pk=self.account.pk).update(mssv="BROKEN001")
        response = self.edit(mssv="NEW001")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "identity_review_required")
        self.account.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.account.mssv, "BROKEN001")
        self.assertEqual(self.profile.mssv, "OLD001")

    def test_reads_of_mismatched_identity_do_not_create_or_claim_another_profile(self):
        other = Participant.objects.create(mssv="NEW001", full_name="Other")
        other_team = Team.objects.create(code="ID002", name="Other team")
        TeamMembership.objects.create(team=other_team, participant=other)
        Account.objects.filter(pk=self.account.pk).update(mssv="NEW001")
        for url in ("/api/me/profile", "/api/my-team"):
            response = self.client.get(url, **self.user_auth)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["error"], "identity_review_required")
        members = self.client.get("/api/teams/ID001", **self.admin_auth).json()["members"]
        self.assertTrue(members[0]["has_account"])
        other_members = self.client.get("/api/teams/ID002", **self.admin_auth).json()["members"]
        self.assertFalse(other_members[0]["has_account"])
        other.refresh_from_db()
        self.assertIsNone(other.account_id)
        self.assertEqual(Participant.objects.count(), 2)

    def test_account_without_link_cannot_claim_existing_profile_through_admin_edit(self):
        self.profile.account = None
        self.profile.save(update_fields=["account"])
        response = self.edit(mssv="OLD001", full_name="Changed")
        self.assertEqual(response.status_code, 409)
        self.profile.refresh_from_db()
        self.assertIsNone(self.profile.account_id)
        self.account.refresh_from_db()
        self.assertEqual(self.account.full_name, "Person")

    def test_unlinked_account_cannot_abandon_ambiguous_old_profile(self):
        self.profile.account = None
        self.profile.save(update_fields=["account"])
        self.assertEqual(self.edit(mssv="NEW001", email="new@identity.test").status_code, 409)
        self.profile.refresh_from_db()
        self.assertIsNone(self.profile.account_id)
        self.account.refresh_from_db()
        self.assertEqual(self.account.mssv, "OLD001")

    def test_account_without_any_profile_can_edit_without_creating_a_profile(self):
        self.membership.delete()
        self.profile.delete()
        self.assertEqual(self.edit(mssv="NEW001").status_code, 200)
        self.assertFalse(Participant.objects.exists())

    def test_nonidentity_admin_change_does_not_link_unregistered_member(self):
        self.profile.account = None
        self.profile.save(update_fields=["account"])
        self.assertEqual(self.edit(is_active=False).status_code, 200)
        self.profile.refresh_from_db()
        self.assertIsNone(self.profile.account_id)

    def test_unregistered_teammate_can_still_join_web_after_captain_mssv_edit(self):
        teammate = Participant.objects.create(mssv="MEMBER1", full_name="Member", email="member@identity.test")
        membership = TeamMembership.objects.create(team=self.team, participant=teammate)
        self.assertEqual(self.edit(mssv="NEW001").status_code, 200)
        account = Account.objects.create(username="new-member", email=teammate.email)
        linked = auto_link_participant_by_verified_email(account)
        self.assertEqual(linked.pk, teammate.pk)
        membership.refresh_from_db()
        self.assertEqual(membership.team_id, self.team.pk)
        self.assertEqual(membership.participant_id, teammate.pk)
        self.assertEqual(Participant.objects.count(), 2)
