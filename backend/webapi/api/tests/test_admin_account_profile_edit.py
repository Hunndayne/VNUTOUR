"""Admin profile corrections stay on the linked person and preserve private data."""
import json
from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth.hashers import check_password, make_password
from django.db import IntegrityError
from django.test import Client, TestCase

from api.models import Account, AuditLog, Participant, Team, TeamMembership
from api.services.auth_service import generate_session


class AdminAccountProfileEditTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="profile-admin", email="admin@profile.test", role="admin",
        )
        self.auth = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(self.admin)}
        self.account = Account.objects.create(
            username="profile-person", email="person@profile.test", mssv="PROFILE01",
            full_name="Profile Person", phone="0900000001", school="Old school",
            faculty="Old faculty", avatar="https://example.test/old.png",
            password_hash=make_password("Original-password-123"),
            google_sub="original-google-identity",
        )
        generate_session(self.account)
        self.profile = Participant.objects.create(
            account=self.account, mssv=self.account.mssv, email=self.account.email,
            full_name=self.account.full_name, phone=self.account.phone,
            school=self.account.school, faculty=self.account.faculty,
            cccd="012345678901", facebook="https://facebook.com/old-profile",
            date_of_birth=date(2005, 1, 2), discord_id=123456789012345678,
            discord_username="original-discord",
            extra={
                "gender": "female", "untouched": "keep me",
                "registration": {"diet": "vegetarian", "shirt": "M"},
            },
        )
        self.team = Team.objects.create(code="PROF01", name="Profile team", owner_account=self.account)
        self.membership = TeamMembership.objects.create(
            team=self.team, participant=self.profile, is_captain=True,
        )
        self.url = "/api/admin/accounts/profile-person"

    def edit(self, data, *, auth=None, client=None):
        return (client or self.client).patch(
            self.url, data=json.dumps(data), content_type="application/json",
            **(self.auth if auth is None else auth),
        )

    def assert_original_details(self):
        self.account.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.account.email, "person@profile.test")
        self.assertEqual(self.account.phone, "0900000001")
        self.assertEqual(self.account.school, "Old school")
        self.assertEqual(self.account.faculty, "Old faculty")
        self.assertEqual(self.profile.phone, "0900000001")
        self.assertEqual(self.profile.cccd, "012345678901")
        self.assertEqual(self.profile.date_of_birth, date(2005, 1, 2))
        self.assertEqual(self.profile.extra["untouched"], "keep me")
        self.assertFalse(AuditLog.objects.filter(action="account.details_updated").exists())

    def test_contact_and_registration_edits_preserve_person_team_and_authentication(self):
        account_id, profile_id = self.account.pk, self.profile.pk
        token, password_hash = self.account.token, self.account.password_hash
        response = self.edit({
            "phone": "0900000002", "school": "New school", "faculty": "New faculty",
            "avatar": "https://example.test/new.png", "cccd": "987654321012",
            "facebook": "https://facebook.com/new-profile", "date_of_birth": "2006-03-04",
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.account.refresh_from_db()
        self.profile.refresh_from_db()
        self.membership.refresh_from_db()
        self.team.refresh_from_db()
        for field, expected in (("phone", "0900000002"), ("school", "New school"), ("faculty", "New faculty")):
            self.assertEqual(getattr(self.account, field), expected)
            self.assertEqual(getattr(self.profile, field), expected)
        self.assertEqual(self.account.avatar, "https://example.test/new.png")
        self.assertEqual(self.profile.cccd, "987654321012")
        self.assertEqual(self.profile.facebook, "https://facebook.com/new-profile")
        self.assertEqual(self.profile.date_of_birth, date(2006, 3, 4))
        self.assertEqual(self.account.pk, account_id)
        self.assertEqual(self.profile.pk, profile_id)
        self.assertEqual(self.profile.account_id, account_id)
        self.assertEqual(self.membership.participant_id, profile_id)
        self.assertEqual(self.membership.team_id, self.team.pk)
        self.assertTrue(self.membership.is_captain)
        self.assertEqual(self.team.owner_account_id, account_id)
        self.assertEqual(self.account.mssv, "PROFILE01")
        self.assertEqual(self.profile.mssv, "PROFILE01")
        self.assertEqual(self.account.google_sub, "original-google-identity")
        self.assertEqual(self.account.token, token)
        self.assertEqual(self.account.password_hash, password_hash)
        self.assertEqual(self.profile.discord_id, 123456789012345678)
        self.assertEqual(self.profile.extra["untouched"], "keep me")
        self.assertEqual(Participant.objects.count(), 1)

    def test_extra_patch_preserves_unsubmitted_fields_and_nested_values(self):
        response = self.edit({"extra": {
            "gender": "other", "new_answer": ["one", "two"],
        }})
        self.assertEqual(response.status_code, 200, response.content)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.extra, {
            "gender": "other", "untouched": "keep me",
            "registration": {"diet": "vegetarian", "shirt": "M"},
            "new_answer": ["one", "two"],
        })

    def test_extra_patch_initializes_absent_extra_without_touching_other_profile_fields(self):
        self.profile.extra = None
        self.profile.save(update_fields=["extra"])
        response = self.edit({"extra": {"gender": "female"}})
        self.assertEqual(response.status_code, 200, response.content)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.extra, {"gender": "female"})
        self.assertEqual(self.profile.cccd, "012345678901")

    def test_optional_fields_can_be_cleared_explicitly(self):
        for empty in ("", None):
            with self.subTest(empty=empty):
                self.profile.date_of_birth = date(2005, 1, 2)
                self.profile.save(update_fields=["date_of_birth"])
                response = self.edit({"date_of_birth": empty, "cccd": empty, "phone": empty})
                self.assertEqual(response.status_code, 200, response.content)
                self.account.refresh_from_db()
                self.profile.refresh_from_db()
                self.assertIsNone(self.profile.date_of_birth)
                self.assertIn(self.profile.cccd, (None, ""))
                self.assertIn(self.account.phone, (None, ""))
                self.assertIn(self.profile.phone, (None, ""))

    def test_invalid_email_rejects_the_whole_edit(self):
        for invalid in ("not-an-email", "person@@profile.test", ""):
            with self.subTest(email=invalid):
                response = self.edit({"email": invalid, "phone": "0900000002", "cccd": "987654321012"})
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["error"], "invalid_email")
                self.assert_original_details()

    def test_invalid_or_future_date_rejects_the_whole_edit(self):
        for invalid in ("2005-02-30", "02/01/2005", "not-a-date", 20050102, (date.today() + timedelta(days=2)).isoformat()):
            with self.subTest(date_of_birth=invalid):
                response = self.edit({"date_of_birth": invalid, "phone": "0900000002"})
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["error"], "invalid_date_of_birth")
                self.assert_original_details()

    def test_nonobject_extra_rejects_the_whole_edit(self):
        for invalid in ([], "text", 42, None):
            with self.subTest(extra=invalid):
                response = self.edit({"extra": invalid, "phone": "0900000002"})
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["error"], "invalid_profile_extra")
                self.assert_original_details()

    def test_text_limits_and_types_are_validated_before_writing(self):
        for field, limit in (("email", 255), ("phone", 20), ("school", 255), ("faculty", 255), ("avatar", 500), ("cccd", 20), ("facebook", 255)):
            for invalid in ("x" * (limit + 1), ["not a string"]):
                with self.subTest(field=field, value_type=type(invalid).__name__):
                    response = self.edit({"full_name": "Must not persist", field: invalid})
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertEqual(response.json()["error"], "invalid_field")
                    self.assert_original_details()
                    self.assertEqual(self.account.full_name, "Profile Person")

    def test_profile_only_edits_require_an_explicit_link_and_never_claim_a_matching_roster_row(self):
        self.profile.account = None
        self.profile.save(update_fields=["account"])
        for change in ({"cccd": "987654321012"}, {"facebook": "new"}, {"date_of_birth": "2006-03-04"}, {"extra": {"gender": "other"}}):
            with self.subTest(change=change):
                response = self.edit({"phone": "0900000002", **change})
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()["error"], "profile_not_linked")
                self.assert_original_details()
                self.assertIsNone(self.profile.account_id)
        self.assertEqual(Participant.objects.count(), 1)

    def test_nonstring_role_is_rejected_without_writing_other_fields(self):
        for invalid in (["admin"], {"role": "admin"}):
            with self.subTest(role=invalid):
                response = self.edit({"role": invalid, "phone": "0900000002"})
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["error"], "invalid_field")
                self.assertEqual(response.json()["field"], "role")
                self.assert_original_details()

    def test_unlinked_account_can_edit_contact_fields_without_claiming_matching_profile(self):
        self.profile.account = None
        self.profile.save(update_fields=["account"])
        response = self.edit({"phone": "0900000002", "school": "New school", "faculty": "New faculty"})
        self.assertEqual(response.status_code, 200, response.content)
        self.account.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.account.phone, "0900000002")
        self.assertEqual(self.account.school, "New school")
        self.assertEqual(self.account.faculty, "New faculty")
        self.assertEqual(self.profile.phone, "0900000001")
        self.assertEqual(self.profile.school, "Old school")
        self.assertIsNone(self.profile.account_id)
        self.assertEqual(Participant.objects.count(), 1)

    def test_profile_write_failure_rolls_back_account_and_profile_changes_and_audit(self):
        with patch.object(Participant, "save", side_effect=IntegrityError("simulated concurrent write")):
            response = self.edit({"phone": "0900000002", "cccd": "987654321012", "email": "new@profile.test"})
        self.assertEqual(response.status_code, 409, response.content)
        self.assert_original_details()
        self.assertFalse(AuditLog.objects.filter(action="account.identity_updated").exists())

    def test_identity_conflict_rolls_back_profile_and_contact_changes(self):
        Account.objects.create(username="other-person", email="taken@profile.test")
        response = self.edit({"email": "taken@profile.test", "phone": "0900000002", "cccd": "987654321012"})
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["error"], "account_email_conflict")
        self.assert_original_details()

    def test_detail_audit_records_field_names_without_sensitive_values(self):
        response = self.edit({"phone": "0900000002", "cccd": "987654321012", "extra": {"private_answer": "private new answer"}})
        self.assertEqual(response.status_code, 200, response.content)
        log = AuditLog.objects.get(action="account.details_updated")
        self.assertEqual(log.actor_id, self.admin.pk)
        self.assertEqual(log.target_id, str(self.account.pk))
        self.assertEqual(set(log.metadata["account_fields"]), {"phone"})
        self.assertEqual(set(log.metadata["profile_fields"]), {"phone", "cccd", "extra"})
        self.assertIsNone(log.before_data)
        self.assertIsNone(log.after_data)
        recorded = json.dumps({"summary": log.summary, "metadata": log.metadata})
        for secret in ("0900000001", "0900000002", "012345678901", "987654321012", "private new answer"):
            self.assertNotIn(secret, recorded)

    def test_untrusted_identity_and_authentication_fields_cannot_be_overwritten(self):
        token, password_hash = self.account.token, self.account.password_hash
        account_created_at, profile_created_at = self.account.created_at, self.profile.created_at
        response = self.edit({
            "cccd": "987654321012", "password_hash": "attacker-supplied-hash", "token": "attacker-token",
            "google_sub": "attacker-google", "discord_id": 999, "discord_username": "attacker-discord",
            "account_id": self.admin.pk, "created_at": "2000-01-01T00:00:00Z", "username": "renamed-person",
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.account.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.cccd, "987654321012")
        self.assertEqual(self.account.password_hash, password_hash)
        self.assertEqual(self.account.token, token)
        self.assertEqual(self.account.google_sub, "original-google-identity")
        self.assertEqual(self.profile.discord_id, 123456789012345678)
        self.assertEqual(self.profile.discord_username, "original-discord")
        self.assertEqual(self.profile.account_id, self.account.pk)
        self.assertEqual(self.account.username, "profile-person")
        self.assertEqual(self.account.created_at, account_created_at)
        self.assertEqual(self.profile.created_at, profile_created_at)

    def test_existing_explicit_password_reset_still_hashes_the_password(self):
        response = self.edit({"password": "Replacement-password-456", "phone": "0900000002"})
        self.assertEqual(response.status_code, 200, response.content)
        self.account.refresh_from_db()
        self.assertTrue(check_password("Replacement-password-456", self.account.password_hash))
        self.assertNotIn("Replacement-password-456", response.content.decode())

    def test_anonymous_nonadmin_inactive_admin_and_cookie_without_csrf_cannot_edit(self):
        self.assertEqual(self.edit({"phone": "0900000002"}, auth={}).status_code, 401)
        for role in ("participant", "collab"):
            actor = Account.objects.create(username=f"actor-{role}", email=f"{role}@profile.test", role=role)
            auth = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(actor)}
            self.assertEqual(self.edit({"phone": "0900000002"}, auth=auth).status_code, 403)
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.cookies["token"] = self.admin.token
        self.assertEqual(self.edit({"phone": "0900000002"}, client=csrf_client, auth={}).status_code, 403)
        self.admin.is_active = False
        self.admin.save(update_fields=["is_active"])
        self.assertEqual(self.edit({"phone": "0900000002"}).status_code, 401)
        self.assert_original_details()

    def test_plain_admin_cannot_edit_master_admin_profile_but_master_admin_can(self):
        self.account.role = "master_admin"
        self.account.save(update_fields=["role"])
        response = self.edit({"phone": "0900000002", "cccd": "987654321012"})
        self.assertEqual(response.status_code, 403, response.content)
        self.assert_original_details()
        master = Account.objects.create(username="profile-master", email="master@profile.test", role="master_admin")
        auth = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(master)}
        response = self.edit({"phone": "0900000002", "cccd": "987654321012"}, auth=auth)
        self.assertEqual(response.status_code, 200, response.content)
        self.account.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.account.phone, "0900000002")
        self.assertEqual(self.profile.cccd, "987654321012")
