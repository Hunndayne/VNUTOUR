"""Google sign-in adopts a pre-registered member by their verified email, and
the email-mismatch case returns actionable guidance instead of a bare error.

See the flow discussion: captain pre-registers members anchored by MSSV; a
member signing in with Google should land in their team without typing an MSSV
when the (Google-verified) email matches, and be told how to get it fixed when
it does not.
"""

import json
import os
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase

from api.models import (
    Account, Participant, Team, TeamMembership, MssvLinkAudit, SystemSetting,
)
from api.services.auth_service import generate_session
from api.services.team_service import auto_link_participant_by_verified_email


def _participant(mssv, email, full_name="Form Name"):
    return Participant.objects.create(mssv=mssv, full_name=full_name, email=email)


def _account(email, mssv=None):
    return Account.objects.create(
        username=email.split("@")[0],
        email=email,
        password_hash=make_password("x"),
        role=Account.ROLE_PARTICIPANT,
        mssv=mssv,
    )


class AutoLinkServiceTests(TestCase):
    def test_links_when_single_unclaimed_email_match(self):
        p = _participant("2100001", "member@gmail.com")
        acc = _account("member@gmail.com")

        linked = auto_link_participant_by_verified_email(acc)

        self.assertIsNotNone(linked)
        acc.refresh_from_db()
        p.refresh_from_db()
        self.assertEqual(acc.mssv, "2100001")
        self.assertEqual(p.account_id, acc.id)

    def test_email_match_is_case_insensitive(self):
        _participant("2100001", "Member@Gmail.com")
        acc = _account("member@gmail.com")

        self.assertIsNotNone(auto_link_participant_by_verified_email(acc))
        acc.refresh_from_db()
        self.assertEqual(acc.mssv, "2100001")

    def test_no_link_when_no_email_match(self):
        _participant("2100001", "someone@else.com")
        acc = _account("member@gmail.com")

        self.assertIsNone(auto_link_participant_by_verified_email(acc))
        acc.refresh_from_db()
        self.assertIsNone(acc.mssv)

    def test_duplicate_email_cannot_make_auto_link_ambiguous(self):
        _participant("2100001", "dup@gmail.com")
        with self.assertRaises(IntegrityError), transaction.atomic():
            _participant("2100002", "DUP@gmail.com")

    def test_skips_when_account_already_has_mssv(self):
        _participant("2100001", "member@gmail.com")
        acc = _account("member@gmail.com", mssv="2100009")

        self.assertIsNone(auto_link_participant_by_verified_email(acc))

    def test_does_not_steal_a_claimed_participant(self):
        other = _account("other@gmail.com")
        p = _participant("2100001", "member@gmail.com")
        p.account = other
        p.save(update_fields=["account"])
        acc = _account("member@gmail.com")

        self.assertIsNone(auto_link_participant_by_verified_email(acc))
        acc.refresh_from_db()
        self.assertIsNone(acc.mssv)


class RegistrationMismatchResponseTests(TestCase):
    def setUp(self):
        cache.clear()
        self.participant = _participant("2100001", "form@school.edu")
        team = Team.objects.create(code="T0001", name="Team One")
        TeamMembership.objects.create(team=team, participant=self.participant)
        self.account = _account("member@gmail.com")
        self.token = generate_session(self.account)

    def _put_mssv(self):
        return self.client.put(
            "/api/me/profile",
            data=json.dumps({"mssv": "2100001", "full_name": "Member"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_mismatch_returns_team_code_guidance_and_audits(self):
        resp = self._put_mssv()

        self.assertEqual(resp.status_code, 409)
        body = resp.json()
        self.assertEqual(body["error"], "registration_mismatch")
        self.assertEqual(body["detail"]["team_code"], "T0001")
        self.assertEqual(body["detail"]["mssv"], "2100001")
        # Nothing was linked — the captain-entered row is untouched.
        self.participant.refresh_from_db()
        self.assertIsNone(self.participant.account_id)
        self.assertEqual(
            MssvLinkAudit.objects.filter(
                mssv="2100001", account=self.account,
                action=MssvLinkAudit.ACTION_BLOCKED,
            ).count(),
            1,
        )

    def test_retry_does_not_duplicate_the_audit_row(self):
        self._put_mssv()
        self._put_mssv()

        self.assertEqual(
            MssvLinkAudit.objects.filter(
                mssv="2100001", action=MssvLinkAudit.ACTION_BLOCKED,
            ).count(),
            1,
        )


class GoogleLoginAutoLinkViewTests(TestCase):
    """End-to-end through /api/auth/google, mocking only Google's verifier."""

    def setUp(self):
        cache.clear()
        try:
            import google.oauth2.id_token  # noqa: F401
        except ImportError:
            self.skipTest("google-auth not installed")
        SystemSetting.objects.update_or_create(
            key="registration_open", defaults={"value": True},
        )

    def _login(self, email):
        client_id = "test-client.apps.googleusercontent.com"
        id_info = {
            "aud": client_id,
            "email": email,
            "email_verified": True,
            "sub": "google-sub-123",
            "name": "Member",
        }
        with mock.patch.dict(os.environ, {"GOOGLE_CLIENT_ID": client_id}), \
                mock.patch(
                    "google.oauth2.id_token.verify_oauth2_token",
                    return_value=id_info,
                ):
            return self.client.post(
                "/api/auth/google",
                data=json.dumps({"credential": "fake-jwt"}),
                content_type="application/json",
            )

    def test_google_login_adopts_pre_registered_member(self):
        _participant("2100001", "member@gmail.com")

        resp = self._login("member@gmail.com")

        self.assertIn(resp.status_code, (200, 201))
        acc = Account.objects.get(email="member@gmail.com")
        self.assertEqual(acc.mssv, "2100001")
        self.assertEqual(
            Participant.objects.get(mssv="2100001").account_id, acc.id,
        )
