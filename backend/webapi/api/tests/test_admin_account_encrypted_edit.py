"""Encrypted browser edits retain authorization, freshness and profile ownership."""
import base64
import json
import os
import time
from datetime import date
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.test import Client, TestCase

from api.models import Account, AuditLog, Participant, Team, TeamMembership
from api.services.auth_service import generate_session


def encode(value):
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class AdminAccountEncryptedEditTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public_key = base64.b64encode(cls.private_key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo,
        )).decode("ascii")

    def setUp(self):
        self.admin = Account.objects.create(username="encrypted-admin", email="admin@encrypted.test", role="admin")
        self.auth = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(self.admin)}
        self.target = Account.objects.create(
            username="encrypted-person", email="person@encrypted.test", mssv="ENC001",
            full_name="Original person", phone="0900000001", school="Old school", faculty="Old faculty",
            google_sub="original-google", password_hash="original-password-hash",
        )
        self.profile = Participant.objects.create(
            account=self.target, mssv=self.target.mssv, email=self.target.email,
            full_name=self.target.full_name, phone=self.target.phone, school=self.target.school,
            faculty=self.target.faculty, cccd="012345678901", date_of_birth=date(2005, 1, 2),
            discord_id=123456789012345678,
            extra={"gender": "female", "untouched": {"nested": "keep this"}},
        )
        self.team = Team.objects.create(code="ENC01", name="Encrypted team")
        self.membership = TeamMembership.objects.create(team=self.team, participant=self.profile, is_captain=True)
        self.read_url = "/api/admin/accounts/encrypted-person/details"
        self.edit_url = self.read_url + "/edit"

    def get_details(self):
        response = self.client.post(
            self.read_url, data=json.dumps({"public_key": self.public_key}),
            content_type="application/json", **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("no-store", response["Cache-Control"])
        protected, wrapped, nonce, ciphertext, tag = response.json()["jwe"].split(".")
        aes_key = self.private_key.decrypt(decode(wrapped), padding.OAEP(
            mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None,
        ))
        plaintext = AESGCM(aes_key).decrypt(
            decode(nonce), decode(ciphertext) + decode(tag), protected.encode("ascii"),
        )
        details = json.loads(plaintext)
        self.assertEqual(len(decode(details["_edit"]["key"])), 32)
        self.assertNotIn(details["_edit"]["key"], response.content.decode())
        self.assertNotIn(details["_edit"]["grant"], response.content.decode())
        return details

    def encrypted_body(self, details, changes):
        edit = details["_edit"]
        nonce = os.urandom(12)
        ciphertext = AESGCM(decode(edit["key"])).encrypt(
            nonce, json.dumps(changes).encode("utf-8"),
            f"vnutour-account-edit-v1:{details['account']['id']}".encode("ascii"),
        )
        return {"grant": edit["grant"], "iv": encode(nonce), "ciphertext": encode(ciphertext)}

    def submit(self, body, *, url=None, auth=None, client=None):
        return (client or self.client).post(
            url or self.edit_url, data=json.dumps(body), content_type="application/json",
            **(self.auth if auth is None else auth),
        )

    def assert_original(self):
        self.target.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.target.phone, "0900000001")
        self.assertEqual(self.profile.cccd, "012345678901")
        self.assertEqual(self.profile.account_id, self.target.pk)
        self.assertFalse(AuditLog.objects.filter(action="account.details_updated").exists())

    def test_encrypted_edit_updates_complete_profile_preserves_extra_and_returns_no_personal_data(self):
        details = self.get_details()
        changes = {
            "email": "corrected@encrypted.test", "mssv": "ENC002", "full_name": "Corrected person",
            "phone": "0900000002", "school": "New school", "faculty": "New faculty",
            "avatar": "https://example.test/avatar.png", "cccd": "987654321012",
            "facebook": "https://facebook.com/corrected", "date_of_birth": "2006-03-04",
            "extra": {"gender": "other"},
        }
        body = self.encrypted_body(details, changes)
        self.assertNotIn(changes["cccd"], json.dumps(body))
        response = self.submit(body)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"status": "updated"})
        self.assertIn("no-store", response["Cache-Control"])
        self.target.refresh_from_db()
        self.profile.refresh_from_db()
        self.membership.refresh_from_db()
        for field in ("email", "mssv", "full_name", "phone", "school", "faculty"):
            self.assertEqual(getattr(self.target, field), changes[field])
            self.assertEqual(getattr(self.profile, field), changes[field])
        self.assertEqual(self.target.avatar, changes["avatar"])
        self.assertEqual(self.profile.cccd, changes["cccd"])
        self.assertEqual(self.profile.facebook, changes["facebook"])
        self.assertEqual(self.profile.date_of_birth, date(2006, 3, 4))
        self.assertEqual(self.profile.extra, {"gender": "other", "untouched": {"nested": "keep this"}})
        self.assertEqual(self.profile.account_id, self.target.pk)
        self.assertEqual(self.membership.participant_id, self.profile.pk)
        self.assertEqual(self.membership.team_id, self.team.pk)
        self.assertTrue(self.membership.is_captain)
        self.assertEqual(self.target.google_sub, "original-google")
        self.assertEqual(self.profile.discord_id, 123456789012345678)
        self.assertEqual(self.target.password_hash, "original-password-hash")
        log = AuditLog.objects.get(action="account.details_updated")
        self.assertIsNone(log.before_data)
        self.assertIsNone(log.after_data)
        audit_json = json.dumps(log.metadata)
        for secret in (changes["cccd"], details["_edit"]["key"], details["_edit"]["grant"]):
            self.assertNotIn(secret, audit_json)

    def test_successful_edit_cannot_be_replayed(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002"})
        self.assertEqual(self.submit(body).status_code, 200)
        response = self.submit(body)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["error"], "account_changed")
        self.assertEqual(AuditLog.objects.filter(action="account.details_updated").count(), 1)

    def test_grant_cannot_be_used_for_another_account(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002"})
        other = Account.objects.create(username="encrypted-other", email="other@encrypted.test")
        response = self.submit(body, url=f"/api/admin/accounts/{other.username}/details/edit")
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["error"], "edit_session_invalid")
        self.assert_original()
        other.refresh_from_db()
        self.assertIsNone(other.phone)

    def test_grant_cannot_be_used_by_another_admin(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002"})
        other = Account.objects.create(username="encrypted-other-admin", email="other-admin@encrypted.test", role="admin")
        auth = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(other)}
        response = self.submit(body, auth=auth)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["error"], "edit_session_invalid")
        self.assert_original()

    def test_grant_is_invalid_after_admin_starts_a_new_session(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002"})
        auth = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(self.admin)}
        response = self.submit(body, auth=auth)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["error"], "edit_session_invalid")
        self.assert_original()

    def test_expired_grant_cannot_edit(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002"})
        with patch("cryptography.fernet.time.time", return_value=time.time() + 301):
            response = self.submit(body)
        self.assertEqual(response.status_code, 410, response.content)
        self.assertEqual(response.json()["error"], "edit_session_expired")
        self.assert_original()

    def test_ciphertext_tampering_and_malformed_iv_are_rejected(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002"})
        damaged = bytearray(decode(body["ciphertext"]))
        damaged[-1] ^= 1
        for malformed in ({**body, "ciphertext": encode(damaged)}, {**body, "iv": encode(b"short")}, {**body, "ciphertext": "not!base64"}):
            with self.subTest(fields=malformed.keys()):
                response = self.submit(malformed)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["error"], "invalid_encrypted_request")
                self.assert_original()

    def test_plaintext_fallback_and_nonobject_decrypted_body_are_rejected(self):
        details = self.get_details()
        for body in (
            {"phone": "0900000002"},
            {"grant": details["_edit"]["grant"], "changes": {"phone": "0900000002"}},
            self.encrypted_body(details, ["phone", "0900000002"]),
        ):
            response = self.submit(body)
            self.assertEqual(response.status_code, 400, response.content)
            self.assertEqual(response.json()["error"], "invalid_encrypted_request")
            self.assert_original()

    def test_stale_account_revision_cannot_overwrite_concurrent_change(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002", "cccd": "987654321012"})
        self.target.phone = "0900000003"
        self.target.save(update_fields=["phone", "updated_at"])
        response = self.submit(body)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["error"], "account_changed")
        self.target.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.target.phone, "0900000003")
        self.assertEqual(self.profile.cccd, "012345678901")
        self.assertFalse(AuditLog.objects.filter(action="account.details_updated").exists())

    def test_stale_profile_revision_cannot_overwrite_concurrent_change(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002", "cccd": "987654321012"})
        self.profile.cccd = "111111111111"
        self.profile.save(update_fields=["cccd", "updated_at"])
        response = self.submit(body)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["error"], "account_changed")
        self.target.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.target.phone, "0900000001")
        self.assertEqual(self.profile.cccd, "111111111111")
        self.assertFalse(AuditLog.objects.filter(action="account.details_updated").exists())

    def test_profile_link_removed_after_read_requires_refresh(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002"})
        self.profile.account = None
        self.profile.save(update_fields=["account", "updated_at"])
        response = self.submit(body)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["error"], "account_changed")
        self.target.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.target.phone, "0900000001")
        self.assertIsNone(self.profile.account_id)

    def test_profile_only_edit_without_link_is_rejected(self):
        self.profile.account = None
        self.profile.save(update_fields=["account", "updated_at"])
        details = self.get_details()
        self.assertIsNone(details["participant"])
        response = self.submit(self.encrypted_body(details, {"phone": "0900000002", "cccd": "987654321012"}))
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["error"], "profile_not_linked")
        self.target.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.target.phone, "0900000001")
        self.assertEqual(self.profile.cccd, "012345678901")
        self.assertIsNone(self.profile.account_id)

    def test_authentication_admin_role_and_cookie_csrf_are_required(self):
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002"})
        self.assertEqual(self.submit(body, auth={}).status_code, 401)
        for role in ("participant", "collab"):
            actor = Account.objects.create(username=f"encrypted-{role}", email=f"{role}@encrypted.test", role=role)
            auth = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(actor)}
            self.assertEqual(self.submit(body, auth=auth).status_code, 403)
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.cookies["token"] = self.admin.token
        self.assertEqual(self.submit(body, client=csrf_client, auth={}).status_code, 403)
        self.admin.is_active = False
        self.admin.save(update_fields=["is_active"])
        self.assertEqual(self.submit(body).status_code, 401)
        self.assert_original()

    def test_plain_admin_cannot_edit_master_account_using_encrypted_grant(self):
        self.target.role = "master_admin"
        self.target.save(update_fields=["role", "updated_at"])
        body = self.encrypted_body(self.get_details(), {"phone": "0900000002"})
        response = self.submit(body)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["error"], "master_admin_required")
        self.assert_original()
