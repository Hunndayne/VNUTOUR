"""Team payment (VietQR) — payment_service, submission_storage_service, and the
`/api/my-team/payment*` + `/api/admin/payment-config` + `/api/admin/teams/{id}/payment-proof`
endpoints.

Covers:
  - payment_service.build_payment_info / ensure_payment_code / strip_accents_upper
  - payment_service.get_payment_config / save_payment_config defaults + round-trip
  - GET /api/my-team/payment shape
  - POST /api/my-team/payment-proof (multipart) + GET .../payment-proof/file
  - team isolation (another team's caller never sees this team's proof)
  - GET /api/admin/teams/{id}/payment-proof
  - the payment_proof submit gate on POST /api/my-team/submit
  - GET/PUT /api/admin/payment-config
"""

from datetime import date
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from api.models import Account, Participant, SystemSetting, Team, TeamMembership
from api.services.auth_service import generate_session
from api.services.payment_service import (
    DEFAULT_PAYMENT_CONFIG,
    build_payment_info,
    ensure_payment_code,
    get_payment_config,
    save_payment_config,
    strip_accents_upper,
)

# A tiny valid-looking PNG payload — content doesn't need to be a real image,
# the endpoints under test never decode it.
PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-png-bytes-for-tests"


class PaymentServiceTests(TestCase):
    """Unit tests for api.services.payment_service, no HTTP involved."""

    def setUp(self):
        self.account = Account.objects.create(
            username="captain",
            email="captain@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV001",
        )
        self.participant = Participant.objects.create(
            account=self.account,
            mssv="SV001",
            full_name="Nguyễn Văn A",
            email="captain@example.com",
        )
        self.team = Team.objects.create(code="T0001", name="Team A")
        TeamMembership.objects.create(
            team=self.team, participant=self.participant, is_captain=True,
        )

    def test_strip_accents_upper_strips_diacritics_and_uppercases(self):
        self.assertEqual(strip_accents_upper("Nguyễn Văn A"), "NGUYEN VAN A")

    def test_strip_accents_upper_maps_dj_and_collapses_whitespace(self):
        self.assertEqual(strip_accents_upper("  Đặng   Thị  Đông "), "DANG THI DONG")

    def test_strip_accents_upper_empty_string(self):
        self.assertEqual(strip_accents_upper(""), "")

    def test_ensure_payment_code_is_six_digits_and_stable(self):
        first = ensure_payment_code(self.team)

        self.assertEqual(len(first), 6)
        self.assertTrue(first.isdigit())

        self.team.refresh_from_db()
        second = ensure_payment_code(self.team)

        self.assertEqual(second, first)
        self.assertEqual(self.team.payment_code, first)

    def test_build_payment_info_content_format_strips_accents_and_uppercases(self):
        info = build_payment_info(self.team)

        expected_prefix = DEFAULT_PAYMENT_CONFIG["prefix"]
        code = self.team.payment_code
        self.assertEqual(
            info["content"],
            f"{expected_prefix} {code} - SV001 - NGUYEN VAN A",
        )

    def test_build_payment_info_amount_is_fee_times_member_count(self):
        member_account = Account.objects.create(
            username="member1",
            email="member1@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV002",
        )
        member = Participant.objects.create(
            account=member_account,
            mssv="SV002",
            full_name="Member Two",
            email="member1@example.com",
        )
        TeamMembership.objects.create(team=self.team, participant=member, is_captain=False)

        info = build_payment_info(self.team)

        self.assertEqual(info["member_count"], 2)
        self.assertEqual(info["fee_per_person"], DEFAULT_PAYMENT_CONFIG["fee_per_person"])
        self.assertEqual(info["amount"], DEFAULT_PAYMENT_CONFIG["fee_per_person"] * 2)

    def test_build_payment_info_has_proof_false_initially(self):
        info = build_payment_info(self.team)

        self.assertFalse(info["has_proof"])

    def test_build_payment_info_has_proof_true_from_legacy_field(self):
        self.team.payment_proof = "https://example.com/proof.png"
        self.team.save(update_fields=["payment_proof"])

        info = build_payment_info(self.team)

        self.assertTrue(info["has_proof"])


class PaymentConfigServiceTests(TestCase):
    def test_get_payment_config_returns_defaults_when_unseeded(self):
        SystemSetting.objects.filter(key="payment_config").delete()

        config = get_payment_config()

        self.assertEqual(config["fee_per_person"], 25000)
        self.assertEqual(config["prefix"], "VNUTOUR2026")
        self.assertEqual(config["bank_bin"], DEFAULT_PAYMENT_CONFIG["bank_bin"])

    def test_save_payment_config_persists_and_round_trips(self):
        saved = save_payment_config({
            "fee_per_person": 30000,
            "account_no": "0123456789",
            "account_name": "Nguyen Van B",
            "bank_short_name": "MB Bank",
            "prefix": "VNUTOUR-TEST",
        })

        self.assertEqual(saved["fee_per_person"], 30000)
        self.assertEqual(saved["account_no"], "0123456789")

        reloaded = get_payment_config()
        self.assertEqual(reloaded["fee_per_person"], 30000)
        self.assertEqual(reloaded["account_no"], "0123456789")
        self.assertEqual(reloaded["account_name"], "Nguyen Van B")
        self.assertEqual(reloaded["bank_short_name"], "MB Bank")
        self.assertEqual(reloaded["prefix"], "VNUTOUR-TEST")

    def test_save_payment_config_rejects_invalid_fee(self):
        with self.assertRaises(ValueError):
            save_payment_config({"fee_per_person": "not-a-number"})


class PaymentApiTestBase(TestCase):
    """Shared team/captain fixture for the HTTP-level tests below."""

    def setUp(self):
        self.account = Account.objects.create(
            username="captain",
            email="captain@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV001",
        )
        self.participant = Participant.objects.create(
            account=self.account,
            mssv="SV001",
            full_name="Nguyễn Văn A",
            email="captain@example.com",
            phone="0900000000",
            school="HCMUT",
            faculty="CNTT",
            cccd="012345678901",
            date_of_birth=date(2000, 1, 1),
            facebook="https://facebook.com/captain",
            extra={"gender": "male"},
        )
        self.team = Team.objects.create(
            code="T0001", name="Pending team SV001", owner_account=self.account,
        )
        TeamMembership.objects.create(
            team=self.team, participant=self.participant, is_captain=True,
        )
        self.token = generate_session(self.account)

    def _other_team_captain_token(self, code="T0002", mssv="SV999"):
        account = Account.objects.create(
            username=f"captain-{code}",
            email=f"{code}@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv=mssv,
        )
        participant = Participant.objects.create(
            account=account, mssv=mssv, full_name="Other Captain",
            email=f"{code}@example.com",
        )
        team = Team.objects.create(code=code, name=f"Pending team {mssv}", owner_account=account)
        TeamMembership.objects.create(team=team, participant=participant, is_captain=True)
        return team, generate_session(account)


class MyTeamPaymentViewTests(PaymentApiTestBase):
    def test_get_payment_returns_expected_shape(self):
        response = self.client.get(
            "/api/my-team/payment",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            set(payload),
            {
                "amount", "content", "payment_code", "member_count",
                "fee_per_person", "bank", "qr_image_url", "has_proof",
            },
        )
        self.assertEqual(
            set(payload["bank"]), {"bin", "short_name", "account_no", "account_name"},
        )
        self.assertEqual(payload["member_count"], 1)
        self.assertFalse(payload["has_proof"])
        self.assertEqual(len(payload["payment_code"]), 6)

    def test_get_payment_requires_captain(self):
        member_account = Account.objects.create(
            username="member1", email="member1@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV002",
        )
        member = Participant.objects.create(
            account=member_account, mssv="SV002", full_name="Member",
            email="member1@example.com",
        )
        TeamMembership.objects.create(team=self.team, participant=member, is_captain=False)

        response = self.client.get(
            "/api/my-team/payment",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(member_account)}",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "not_team_owner")

    def test_get_payment_requires_auth(self):
        response = self.client.get("/api/my-team/payment")

        self.assertEqual(response.status_code, 401)


class PaymentProofUploadTests(PaymentApiTestBase):
    def setUp(self):
        super().setUp()
        self.media_root = tempfile.mkdtemp(prefix="vnutour-payment-media-")
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)

    def _upload(self, token=None, filename="proof.png", content_type="image/png"):
        with override_settings(MEDIA_ROOT=self.media_root):
            return self.client.post(
                "/api/my-team/payment-proof",
                data={"file": SimpleUploadedFile(filename, PNG_BYTES, content_type=content_type)},
                HTTP_AUTHORIZATION=f"Bearer {token or self.token}",
            )

    def _fetch_file(self, token=None):
        with override_settings(MEDIA_ROOT=self.media_root):
            return self.client.get(
                "/api/my-team/payment-proof/file",
                HTTP_AUTHORIZATION=f"Bearer {token or self.token}",
            )

    def test_upload_sets_has_proof_true(self):
        response = self._upload()

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["has_proof"])
        self.assertEqual(payload["name"], "proof.png")
        self.assertEqual(payload["size"], len(PNG_BYTES))

        self.team.refresh_from_db()
        self.assertTrue(self.team.payment_proof_file)
        self.assertEqual(self.team.payment_proof_file["storage"], "local")

    def test_payment_view_reports_has_proof_true_after_upload(self):
        self._upload()

        response = self.client.get(
            "/api/my-team/payment",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertTrue(response.json()["has_proof"])

    def test_get_file_after_upload_serves_or_redirects(self):
        self._upload()

        response = self._fetch_file()

        self.assertIn(response.status_code, (200, 302))

    def test_get_file_before_upload_is_not_found(self):
        response = self._fetch_file()

        self.assertEqual(response.status_code, 404)

    def test_another_team_does_not_see_this_teams_proof(self):
        """No endpoint accepts a team id from the caller — my-team/* always
        resolves to the caller's own team — so an unrelated captain hitting
        the same route can only ever see their own (here: absent) proof.
        """
        self._upload()
        _, other_token = self._other_team_captain_token()

        response = self._fetch_file(token=other_token)

        self.assertEqual(response.status_code, 404)

    def test_non_captain_member_cannot_reach_the_proof_endpoint(self):
        member_account = Account.objects.create(
            username="member1", email="member1@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV002",
        )
        member = Participant.objects.create(
            account=member_account, mssv="SV002", full_name="Member",
            email="member1@example.com",
        )
        TeamMembership.objects.create(team=self.team, participant=member, is_captain=False)

        response = self._fetch_file(token=generate_session(member_account))

        self.assertEqual(response.status_code, 403)

    def test_admin_can_fetch_the_proof_by_team_id(self):
        self._upload()
        admin = Account.objects.create(
            username="admin1", email="admin1@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )

        with override_settings(MEDIA_ROOT=self.media_root):
            response = self.client.get(
                f"/api/admin/teams/{self.team.id}/payment-proof",
                HTTP_AUTHORIZATION=f"Bearer {generate_session(admin)}",
            )

        self.assertEqual(response.status_code, 200)

    def test_admin_fetch_404s_when_no_proof_uploaded(self):
        admin = Account.objects.create(
            username="admin1", email="admin1@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )

        response = self.client.get(
            f"/api/admin/teams/{self.team.id}/payment-proof",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(admin)}",
        )

        self.assertEqual(response.status_code, 404)

    def test_non_admin_cannot_fetch_via_the_admin_route(self):
        self._upload()

        response = self.client.get(
            f"/api/admin/teams/{self.team.id}/payment-proof",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 403)

    def test_disallowed_file_type_is_rejected(self):
        response = self._upload(filename="proof.exe", content_type="application/octet-stream")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "file_type_not_allowed")


class SubmitPaymentGateTests(PaymentApiTestBase):
    """The payment_proof requirement on POST /api/my-team/submit."""

    def setUp(self):
        super().setUp()
        SystemSetting.objects.create(key="registration_open", value=True)
        self.media_root = tempfile.mkdtemp(prefix="vnutour-payment-media-")
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)

    def _submit(self):
        return self.client.post(
            "/api/my-team/submit",
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_submit_without_proof_is_rejected_for_missing_payment_proof(self):
        response = self._submit()

        self.assertEqual(response.status_code, 400)
        self.assertIn("payment_proof", response.json()["error"])

    def test_submit_after_uploading_proof_no_longer_hits_the_payment_gate(self):
        with override_settings(MEDIA_ROOT=self.media_root):
            upload = self.client.post(
                "/api/my-team/payment-proof",
                data={"file": SimpleUploadedFile("proof.png", PNG_BYTES, content_type="image/png")},
                HTTP_AUTHORIZATION=f"Bearer {self.token}",
            )
        self.assertEqual(upload.status_code, 200)

        response = self._submit()

        # The captain profile in setUp is complete against the default schema,
        # so this should succeed outright — but the specific behaviour this
        # test pins down is that the payment_proof gate no longer fires.
        if response.status_code != 200:
            self.assertNotEqual(response.json().get("error"), "missing:team:payment_proof")
        else:
            self.assertEqual(response.json()["approval_status"], Team.APPROVAL_PENDING)

    def test_submit_passes_the_payment_gate_via_legacy_payment_proof_field(self):
        """The legacy pasted-link field also satisfies the gate."""
        self.team.payment_proof = "https://example.com/proof.png"
        self.team.save(update_fields=["payment_proof"])

        response = self._submit()

        if response.status_code != 200:
            self.assertNotEqual(response.json().get("error"), "missing:team:payment_proof")
        else:
            self.assertEqual(response.json()["approval_status"], Team.APPROVAL_PENDING)


class AdminPaymentConfigViewTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin1", email="admin1@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.admin_token = generate_session(self.admin)
        self.non_admin = Account.objects.create(
            username="participant1", email="participant1@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV001",
        )
        self.non_admin_token = generate_session(self.non_admin)

    def test_non_admin_get_is_forbidden(self):
        response = self.client.get(
            "/api/admin/payment-config",
            HTTP_AUTHORIZATION=f"Bearer {self.non_admin_token}",
        )

        self.assertEqual(response.status_code, 403)

    def test_anonymous_get_is_unauthorized(self):
        response = self.client.get("/api/admin/payment-config")

        self.assertEqual(response.status_code, 401)

    def test_admin_get_returns_config(self):
        response = self.client.get(
            "/api/admin/payment-config",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        config = response.json()["payment_config"]
        self.assertEqual(config["fee_per_person"], 25000)
        self.assertEqual(config["prefix"], "VNUTOUR2026")

    def test_admin_put_updates_config_and_get_reflects_it(self):
        import json

        put_response = self.client.put(
            "/api/admin/payment-config",
            data=json.dumps({"fee_per_person": 40000, "account_no": "9999999999"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(put_response.status_code, 200)
        self.assertEqual(put_response.json()["payment_config"]["fee_per_person"], 40000)

        get_response = self.client.get(
            "/api/admin/payment-config",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        config = get_response.json()["payment_config"]
        self.assertEqual(config["fee_per_person"], 40000)
        self.assertEqual(config["account_no"], "9999999999")
