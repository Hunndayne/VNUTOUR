"""Web "Connect Discord" OAuth flow — link, unlink, and membership-aware status.

The Discord HTTP calls (code exchange, /users/@me, guild-member lookup) are
mocked; everything below them — resolving the logged-in account to its
participant, the anti-theft rules in claim_discord_identity, and the status
shape the frontend reads — runs for real.
"""

from unittest import mock

from django.contrib.auth.hashers import make_password
from django.test import TestCase

from api.models import Account, Participant
from api.services.auth_service import generate_session

OAUTH = "api.services.discord_oauth_service"


def _participant(mssv, email, full_name="Tester", **kw):
    return Participant.objects.create(mssv=mssv, full_name=full_name, email=email, **kw)


def _account(mssv, email="tester@vnu.edu.vn"):
    return Account.objects.create(
        username=email.split("@")[0],
        email=email,
        password_hash=make_password("x"),
        role=Account.ROLE_PARTICIPANT,
        mssv=mssv,
    )


class DiscordLinkTests(TestCase):
    def setUp(self):
        self.participant = _participant("2100001", "tester@vnu.edu.vn")
        self.acc = _account("2100001")
        self.token = generate_session(self.acc)

    def _post(self, body):
        return self.client.post(
            "/api/auth/me/discord",
            data=body,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_link_success_stores_id_and_username(self):
        with mock.patch(f"{OAUTH}.exchange_code", return_value="tok"), \
             mock.patch(f"{OAUTH}.fetch_discord_user",
                        return_value={"id": 123456789012345678, "display": "tester#1"}):
            resp = self._post({"code": "abc", "redirect_uri": "http://localhost:5173/participant"})

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "discord_linked")
        # Snowflake id crosses back out as a string, unharmed by JSON precision.
        self.assertEqual(data["discord_id"], "123456789012345678")
        self.participant.refresh_from_db()
        self.assertEqual(self.participant.discord_id, 123456789012345678)
        self.assertEqual(self.participant.discord_username, "tester#1")

    def test_link_refuses_discord_owned_by_another_participant(self):
        _participant("2100002", "other@vnu.edu.vn", discord_id=123456789012345678)
        with mock.patch(f"{OAUTH}.exchange_code", return_value="tok"), \
             mock.patch(f"{OAUTH}.fetch_discord_user",
                        return_value={"id": 123456789012345678, "display": "thief"}):
            resp = self._post({"code": "abc", "redirect_uri": "http://localhost:5173/participant"})

        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "discord_already_linked_other")
        self.participant.refresh_from_db()
        self.assertIsNone(self.participant.discord_id)

    def test_link_missing_fields(self):
        resp = self._post({"code": "", "redirect_uri": ""})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"], "missing_fields")

    def test_link_bad_code_maps_to_400(self):
        from api.services.discord_oauth_service import DiscordOAuthError
        with mock.patch(f"{OAUTH}.exchange_code", side_effect=DiscordOAuthError("invalid_code")):
            resp = self._post({"code": "bad", "redirect_uri": "http://localhost:5173/participant"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"], "invalid_code")

    def test_link_requires_a_participant(self):
        acc = _account(None, email="nomssv@vnu.edu.vn")
        token = generate_session(acc)
        resp = self.client.post(
            "/api/auth/me/discord",
            data={"code": "abc", "redirect_uri": "http://localhost:5173/participant"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "participant_not_found")

    def test_unlink_clears_the_link(self):
        self.participant.discord_id = 123456789012345678
        self.participant.discord_username = "tester#1"
        self.participant.save(update_fields=["discord_id", "discord_username"])

        resp = self.client.delete(
            "/api/auth/me/discord",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "discord_unlinked")
        self.participant.refresh_from_db()
        self.assertIsNone(self.participant.discord_id)
        self.assertIsNone(self.participant.discord_username)


class DiscordStatusTests(TestCase):
    def setUp(self):
        self.participant = _participant("2100001", "tester@vnu.edu.vn")
        self.acc = _account("2100001")
        self.token = generate_session(self.acc)

    def _get(self):
        return self.client.get(
            "/api/auth/me/discord/status",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_status_not_linked(self):
        resp = self._get()
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertFalse(data["linked"])
        self.assertIn("oauth", data)
        self.assertIn("configured", data["oauth"])

    def test_status_linked_and_in_server(self):
        self.participant.discord_id = 123456789012345678
        self.participant.discord_username = "old"
        self.participant.save(update_fields=["discord_id", "discord_username"])
        with mock.patch(f"{OAUTH}.lookup_guild_member",
                        return_value={"configured": True, "in_guild": True, "display": "nick"}):
            resp = self._get()
        data = resp.json()
        self.assertTrue(data["linked"])
        self.assertEqual(data["in_server"], True)
        self.assertEqual(data["discord_id"], "123456789012345678")
        # A fresh handle from the guild wins over the stored one.
        self.assertEqual(data["discord_username"], "nick")

    def test_status_linked_but_not_in_server(self):
        self.participant.discord_id = 123456789012345678
        self.participant.save(update_fields=["discord_id"])
        with mock.patch(f"{OAUTH}.lookup_guild_member",
                        return_value={"configured": True, "in_guild": False, "display": None}):
            resp = self._get()
        data = resp.json()
        self.assertTrue(data["linked"])
        self.assertEqual(data["in_server"], False)

    def test_status_membership_unknown_is_null(self):
        self.participant.discord_id = 123456789012345678
        self.participant.discord_username = "stored"
        self.participant.save(update_fields=["discord_id", "discord_username"])
        with mock.patch(f"{OAUTH}.lookup_guild_member",
                        return_value={"configured": False, "in_guild": None, "display": None}):
            resp = self._get()
        data = resp.json()
        self.assertTrue(data["linked"])
        self.assertIsNone(data["in_server"])
        self.assertEqual(data["discord_username"], "stored")
