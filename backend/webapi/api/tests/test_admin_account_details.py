import base64
import json
from datetime import date
from urllib.parse import quote

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.test import Client, TestCase

from api.models import Account, AuditLog, Participant, Team, TeamMembership
from api.services.auth_service import generate_session


def decode(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


class AdminAccountDetailsTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public_key = cls.encode_key(cls.private_key.public_key())

    @staticmethod
    def encode_key(key):
        return base64.b64encode(key.public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo,
        )).decode('ascii')

    def setUp(self):
        self.admin = Account.objects.create(username='admin-detail', email='admin@detail.test', role='admin')
        self.auth = {'HTTP_AUTHORIZATION': 'Bearer ' + generate_session(self.admin)}
        self.target = Account.objects.create(
            username='Nguyễn Bảo Ân', email='person@detail.test', mssv='SV001',
            full_name='Person', phone='0901234567', school='School', faculty='Faculty',
            password_hash='PRIVATE_PASSWORD_HASH', google_sub='PRIVATE_GOOGLE_SUB',
        )
        generate_session(self.target)
        self.profile = Participant.objects.create(
            account=self.target, mssv='SV001', email=self.target.email, full_name='Person',
            cccd='012345678901', date_of_birth=date(2005, 1, 2),
            discord_id=123456789012345678, discord_username='person-discord',
            extra={'gender': 'male', 'notes': '<script>unsafe()</script>'},
        )
        self.team = Team.objects.create(code='DET01', name='Detail team')
        TeamMembership.objects.create(team=self.team, participant=self.profile, is_captain=True)
        self.url = '/api/admin/accounts/' + quote(self.target.username) + '/details'

    def request(self, data=None, auth=None):
        return self.client.post(self.url, data=json.dumps(data if data is not None else {'public_key': self.public_key}),
                                content_type='application/json', **(self.auth if auth is None else auth))

    def decrypt(self, response):
        protected, wrapped, nonce, ciphertext, tag = response.json()['jwe'].split('.')
        key = self.private_key.decrypt(decode(wrapped), padding.OAEP(
            mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None,
        ))
        plaintext = AESGCM(key).decrypt(decode(nonce), decode(ciphertext) + decode(tag), protected.encode('ascii'))
        return json.loads(plaintext)

    def test_admin_receives_encrypted_complete_dossier_without_auth_secrets(self):
        response = self.request()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {'encrypted', 'jwe'})
        self.assertIn('no-store', response['Cache-Control'])
        payload = self.decrypt(response)
        self.assertEqual(payload['participant']['cccd'], self.profile.cccd)
        self.assertEqual(payload['participant']['date_of_birth'], '2005-01-02')
        self.assertEqual(payload['participant']['discord_id'], '123456789012345678')
        self.assertEqual(payload['participant']['extra'], self.profile.extra)
        self.assertTrue(payload['account']['google_linked'])
        self.assertEqual(payload['account']['phone'], '0901234567')
        self.assertEqual(payload['team']['code'], self.team.code)
        self.assertTrue(payload['team']['is_captain'])
        self.assertEqual(payload['identity_mismatches'], [])
        for secret in (self.target.password_hash, self.target.token, self.target.google_sub):
            self.assertNotIn(secret, json.dumps(payload))
            self.assertNotIn(secret, response.content.decode())
        self.assertNotIn(self.profile.cccd, response.content.decode())
        log = AuditLog.objects.get(action='account.details_viewed')
        self.assertEqual(log.actor_id, self.admin.pk)
        self.assertEqual(log.target_id, str(self.target.pk))
        self.assertIsNone(log.after_data)
        self.assertIsNone(log.before_data)
        self.assertIsNone(log.metadata)

    def test_master_admin_allowed_but_other_roles_and_anonymous_denied(self):
        self.assertEqual(self.request(auth={}).status_code, 401)
        for role, status in [('master_admin', 200), ('collab', 403), ('participant', 403)]:
            actor = Account.objects.create(username=role, email=f'{role}@detail.test', role=role)
            auth = {'HTTP_AUTHORIZATION': 'Bearer ' + generate_session(actor)}
            self.assertEqual(self.request(auth=auth).status_code, status)
        self.assertEqual(AuditLog.objects.filter(action='account.details_viewed').count(), 1)

    def test_inactive_admin_and_cookie_request_without_csrf_denied(self):
        client = Client(enforce_csrf_checks=True)
        client.cookies['token'] = self.admin.token
        self.assertEqual(client.post(self.url, data=json.dumps({'public_key': self.public_key}),
                                    content_type='application/json').status_code, 403)
        self.admin.is_active = False
        self.admin.save(update_fields=['is_active'])
        self.assertEqual(self.request().status_code, 401)

    def test_malformed_weak_and_non_rsa_keys_fail_closed(self):
        weak = rsa.generate_private_key(public_exponent=65537, key_size=1024)
        elliptic = ec.generate_private_key(ec.SECP256R1())
        for key in (None, '', 'not-base64', 'a' * 3000, 123, self.encode_key(weak.public_key()), self.encode_key(elliptic.public_key())):
            with self.subTest(key_type=type(key).__name__):
                self.assertEqual(self.request({'public_key': key}).status_code, 400)
        for body in ([], 'invalid', 12):
            self.assertEqual(self.request(body).status_code, 400)
        self.assertFalse(AuditLog.objects.filter(action='account.details_viewed').exists())

    def test_get_and_plaintext_fallback_are_not_available(self):
        self.assertEqual(self.client.get(self.url, **self.auth).status_code, 405)
        self.assertEqual(self.request({}).status_code, 400)
        existing = self.client.get('/api/admin/accounts/' + quote(self.target.username), **self.auth)
        self.assertNotIn('participant', existing.json())
        self.assertNotIn(self.profile.cccd, existing.content.decode())

    def test_new_ciphertext_each_request_and_tampering_fails_authentication(self):
        first, second = self.request(), self.request()
        self.assertNotEqual(first.json()['jwe'], second.json()['jwe'])
        first_payload, second_payload = self.decrypt(first), self.decrypt(second)
        first_payload.pop('_edit')
        second_payload.pop('_edit')
        self.assertEqual(first_payload, second_payload)
        protected, wrapped, nonce, ciphertext, tag = first.json()['jwe'].split('.')
        key = self.private_key.decrypt(decode(wrapped), padding.OAEP(
            mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None,
        ))
        damaged = bytearray(decode(ciphertext) + decode(tag))
        damaged[0] ^= 1
        with self.assertRaises(InvalidTag):
            AESGCM(key).decrypt(decode(nonce), bytes(damaged), protected.encode('ascii'))
        with self.assertRaises(InvalidTag):
            AESGCM(key).decrypt(decode(nonce), decode(ciphertext) + decode(tag), b'wrong-context')

    def test_mismatched_identity_uses_linked_profile_and_does_not_modify_records(self):
        Account.objects.filter(pk=self.target.pk).update(mssv='OTHER', email='different@detail.test')
        other = Participant.objects.create(mssv='OTHER', email='other@detail.test', full_name='Other')
        payload = self.decrypt(self.request())
        self.assertEqual(payload['participant']['id'], self.profile.pk)
        self.assertEqual(payload['team']['code'], self.team.code)
        self.assertEqual(payload['identity_mismatches'], ['mssv', 'email'])
        self.profile.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual(self.profile.mssv, 'SV001')
        self.assertIsNone(other.account_id)

    def test_unlinked_account_does_not_expose_profile_matching_mssv(self):
        self.profile.account = None
        self.profile.save(update_fields=['account'])
        payload = self.decrypt(self.request())
        self.assertIsNone(payload['participant'])
        self.assertIsNone(payload['team'])
        self.assertNotIn(self.profile.cccd, json.dumps(payload))

    def test_missing_target_returns_404(self):
        self.url = '/api/admin/accounts/missing/details'
        self.assertEqual(self.request().status_code, 404)
