from django.test import TestCase

from api.models import Account, Participant
from api.views_participant import _member_resolution, _prepare_member_submission


class ParticipantMemberSubmissionTests(TestCase):
    def test_member_resolution_excludes_cccd_value_and_field_when_backend_has_cccd(self):
        Account.objects.create(
            username="member1",
            email="member1@gmail.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="26520002",
            full_name="Member One",
            phone="0922222222",
            school="HCMUT",
            faculty="CNTT",
        )
        Participant.objects.create(
            mssv="26520002",
            full_name="Member One",
            email="member1@gmail.com",
            phone="0922222222",
            school="HCMUT",
            faculty="CNTT",
            facebook="https://facebook.com/member1",
            cccd="012345678901",
            date_of_birth="2006-01-01",
        )

        payload, error = _member_resolution({"mssv": "26520002", "email": "member1@gmail.com"})

        self.assertIsNone(error)
        self.assertNotIn("cccd", payload["profile"])
        self.assertNotIn("cccd", [field["key"] for field in payload["fields"]])
        self.assertEqual(payload["profile"]["full_name"], "Member One")
        self.assertEqual(payload["profile"]["school"], "HCMUT")

    def test_member_resolution_keeps_cccd_field_when_backend_missing_cccd(self):
        Account.objects.create(
            username="member0",
            email="member0@gmail.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="26520001",
            full_name="Member Zero",
            phone="0911111111",
            school="HCMUT",
            faculty="CNTT",
        )

        payload, error = _member_resolution({"mssv": "26520001", "email": "member0@gmail.com"})

        self.assertIsNone(error)
        self.assertIn("cccd", [field["key"] for field in payload["fields"]])
        self.assertNotIn("cccd", payload["profile"])

    def test_prepare_member_submission_uses_existing_profile_including_cccd(self):
        Account.objects.create(
            username="member2",
            email="member2@gmail.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="26520003",
            full_name="Member Two",
            phone="0933333333",
            school="HCMUT",
            faculty="CNTT",
        )
        Participant.objects.create(
            mssv="26520003",
            full_name="Member Two",
            email="member2@gmail.com",
            phone="0933333333",
            school="HCMUT",
            faculty="CNTT",
            facebook="https://facebook.com/member2",
            cccd="012345678901",
            date_of_birth="2006-01-02",
        )

        columns, extra, error = _prepare_member_submission(
            {"mssv": "26520003", "email": "member2@gmail.com"},
            "member",
        )

        self.assertIsNone(error)
        self.assertEqual(columns["full_name"], "Member Two")
        self.assertEqual(columns["cccd"], "012345678901")
        self.assertEqual(columns["date_of_birth"], "2006-01-02")

    def test_prepare_member_submission_requires_cccd_when_missing_on_backend(self):
        Account.objects.create(
            username="member3",
            email="member3@gmail.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="26520004",
            full_name="Member Three",
            phone="0944444444",
            school="HCMUT",
            faculty="CNTT",
        )

        _, _, error = _prepare_member_submission(
            {
                "mssv": "26520004",
                "email": "member3@gmail.com",
                "facebook": "https://facebook.com/member3",
                "date_of_birth": "2006-01-03",
            },
            "member",
        )

        self.assertEqual(error, "missing:member:cccd")
