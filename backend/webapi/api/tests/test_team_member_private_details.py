import base64
import json

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.test import TestCase

from api.models import Account, AuditLog, Participant, Team, TeamMembership
from api.services.auth_service import generate_session


def decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class TeamMemberPrivateDetailsTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public_key = base64.b64encode(cls.private_key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )).decode("ascii")

    def setUp(self):
        self.requester_account = Account.objects.create(
            username="team-viewer",
            email="viewer@example.test",
            mssv="SV001",
            role=Account.ROLE_PARTICIPANT,
            is_active=True,
        )
        self.target_account = Account.objects.create(
            username="team-target",
            email="target@example.test",
            mssv="SV002",
            role=Account.ROLE_PARTICIPANT,
            is_active=True,
        )
        self.requester = Participant.objects.create(
            account=self.requester_account,
            mssv="SV001",
            full_name="Nguyen Viewer",
            email="viewer@example.test",
        )
        self.target = Participant.objects.create(
            account=self.target_account,
            mssv="SV002",
            full_name="Tran Target",
            email="target@example.test",
            phone="0901234567",
            school="UIT",
            faculty="Khoa học máy tính",
            facebook="https://facebook.com/team-target",
            discord_id=123456789012345678,
            discord_username="target-discord",
        )
        self.team = Team.objects.create(code="ENC01", name="Encrypted team")
        TeamMembership.objects.create(team=self.team, participant=self.requester)
        TeamMembership.objects.create(team=self.team, participant=self.target, is_captain=True)
        self.url = "/api/my-team/members/SV002/details"
        self.auth = {
            "HTTP_AUTHORIZATION": "Bearer " + generate_session(self.requester_account),
        }

    def request(self, data=None, auth=None):
        return self.client.post(
            self.url,
            data=json.dumps(data if data is not None else {"public_key": self.public_key}),
            content_type="application/json",
            **(self.auth if auth is None else auth),
        )

    def decrypt(self, response):
        protected, wrapped, nonce, ciphertext, tag = response.json()["jwe"].split(".")
        key = self.private_key.decrypt(
            decode(wrapped),
            padding.OAEP(
                mgf=padding.MGF1(hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )
        plaintext = AESGCM(key).decrypt(
            decode(nonce),
            decode(ciphertext) + decode(tag),
            protected.encode("ascii"),
        )
        return json.loads(plaintext)

    def test_teammate_receives_only_requested_dossier_in_encrypted_envelope(self):
        response = self.request()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"encrypted", "jwe"})
        self.assertIn("no-store", response["Cache-Control"])
        for private_value in (self.target.phone, self.target.facebook, self.target.discord_username):
            self.assertNotIn(private_value, response.content.decode())

        payload = self.decrypt(response)
        self.assertEqual(payload, {
            "member": {
                "full_name": "Tran Target",
                "mssv": "SV002",
                "school": "UIT",
                "faculty": "Khoa học máy tính",
                "facebook": "https://facebook.com/team-target",
                "phone": "0901234567",
                "is_captain": True,
            },
            "accounts": {
                "discord": {"connected": True, "username": "target-discord"},
                "web": {"connected": True},
            },
        })
        self.assertNotIn("email", json.dumps(payload))
        self.assertNotIn("cccd", json.dumps(payload))
        log = AuditLog.objects.get(action="team.member_details_viewed")
        self.assertEqual(log.actor_id, self.requester_account.pk)
        self.assertEqual(log.target_id, str(self.target.pk))
        self.assertIsNone(log.metadata)

    def test_team_summary_never_contains_contact_fields_even_for_captain(self):
        response = self.client.get(
            "/api/my-team?view=summary",
            HTTP_AUTHORIZATION="Bearer " + generate_session(self.target_account),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {item["mssv"]: set(item) for item in response.json()["members"]},
            {
                "SV001": {"mssv", "full_name", "school"},
                "SV002": {"mssv", "full_name", "school"},
            },
        )
        for private_value in (self.target.phone, self.target.facebook, self.target.discord_username):
            self.assertNotIn(private_value, response.content.decode())

    def test_member_in_another_team_is_indistinguishable_from_missing(self):
        outsider_account = Account.objects.create(
            username="outsider",
            email="outsider@example.test",
            mssv="SV999",
            role=Account.ROLE_PARTICIPANT,
        )
        outsider = Participant.objects.create(
            account=outsider_account,
            mssv="SV999",
            full_name="Out Sider",
            email="outsider@example.test",
        )
        other_team = Team.objects.create(code="ENC02", name="Other team")
        TeamMembership.objects.create(team=other_team, participant=outsider)

        response = self.client.post(
            self.url,
            data=json.dumps({"public_key": self.public_key}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer " + generate_session(outsider_account),
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"error": "not_found"})
        self.assertFalse(AuditLog.objects.exists())

    def test_no_plaintext_or_invalid_key_fallback_exists(self):
        self.assertEqual(self.client.get(self.url, **self.auth).status_code, 405)
        for body in ({}, {"public_key": "not-base64"}, [], "invalid"):
            with self.subTest(body=body):
                self.assertEqual(self.request(body).status_code, 400)
        self.assertFalse(AuditLog.objects.exists())

    def test_anonymous_and_non_participant_roles_are_denied(self):
        self.assertEqual(self.request(auth={}).status_code, 401)
        admin = Account.objects.create(
            username="details-admin",
            email="details-admin@example.test",
            role=Account.ROLE_ADMIN,
        )
        response = self.request(auth={
            "HTTP_AUTHORIZATION": "Bearer " + generate_session(admin),
        })
        self.assertEqual(response.status_code, 403)
