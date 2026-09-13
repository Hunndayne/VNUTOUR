from datetime import date
import json

from django.test import TestCase

from api.models import (
    Account,
    Participant,
    ProgramPhase,
    SystemSetting,
    Team,
    TeamMembership,
)
from api.services.auth_service import generate_session
from api.views_participant import _member_resolution, _prepare_member_submission


class ParticipantMemberSubmissionTests(TestCase):
    def test_adding_uit_member_does_not_request_cccd_and_saves_uit_default(self):
        ProgramPhase.objects.create(
            key="registration", label="Registration", order=1, is_current=True,
        )
        SystemSetting.objects.create(key="registration_open", value=True)
        captain = Account.objects.create(
            username="uit-captain", email="uit-captain@example.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="SVUIT00",
        )
        team = Team.objects.create(
            code="TUIT", name="UIT test team", owner_account=captain,
        )
        captain_profile = Participant.objects.create(
            account=captain, mssv=captain.mssv, email=captain.email,
        )
        TeamMembership.objects.create(team=team, participant=captain_profile, is_captain=True)
        auth = {"HTTP_AUTHORIZATION": f"Bearer {generate_session(captain)}"}

        for index, source in enumerate(("account", "participant", "linked"), start=1):
            with self.subTest(source=source):
                identity = {"mssv": f"SVUIT0{index}", "email": f"uit-{index}@example.com"}
                profile = {
                    **identity, "full_name": "UIT Member", "school": "UIT",
                    "faculty": "KHMT", "phone": "0911111111",
                }
                account = None
                if source in ("account", "linked"):
                    account = Account.objects.create(
                        **profile, username=f"uit-member-{index}", password_hash="x",
                        role=Account.ROLE_PARTICIPANT,
                    )
                remaining = {
                    "gender": "male", "date_of_birth": "2006-01-01",
                    "facebook": "https://example.com/uit-member",
                }
                if source in ("participant", "linked"):
                    Participant.objects.create(
                        **profile, account=account, cccd="",
                        date_of_birth=remaining["date_of_birth"],
                        facebook=remaining["facebook"], extra={"gender": remaining["gender"]},
                    )

                resolved = self.client.post(
                    "/api/my-team/members/resolve", data=identity,
                    content_type="application/json", **auth,
                )
                self.assertEqual(resolved.status_code, 200)
                payload = resolved.json()
                self.assertEqual(payload["profile"], identity)
                self.assertNotIn("cccd", [field["key"] for field in payload["fields"]])

                # Submit exactly the fields offered by resolve, with no CCCD.
                submission = {
                    **payload["profile"],
                    **{field["key"]: remaining[field["key"]]
                       for field in payload["fields"] if field["key"] in remaining},
                }
                added = self.client.post(
                    "/api/my-team/members", data=submission,
                    content_type="application/json", **auth,
                )
                self.assertEqual(added.status_code, 201, added.content)
                participant = Participant.objects.get(mssv=identity["mssv"])
                self.assertEqual(participant.cccd, "UIT")
                self.assertTrue(TeamMembership.objects.filter(team=team, participant=participant).exists())

    def test_member_resolution_hides_stored_fields_and_never_returns_their_values(self):
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
        # The profile echoes only the identity the captain typed — no PII of a
        # member who may belong to another team is ever disclosed.
        self.assertEqual(
            payload["profile"], {"mssv": "26520002", "email": "member1@gmail.com"},
        )
        field_keys = [field["key"] for field in payload["fields"]]
        # Every already-stored field is hidden (write-only); the captain cannot
        # view or overwrite it. Only the typed identity stays visible.
        for hidden in ("cccd", "full_name", "school", "phone", "faculty", "facebook"):
            self.assertNotIn(hidden, field_keys)
        self.assertIn("mssv", field_keys)
        self.assertIn("email", field_keys)

    def test_member_resolution_shows_only_the_single_missing_field(self):
        # B has a complete profile except for the Facebook link. When A adds B,
        # A must see only the Facebook input (plus the identity A typed) — every
        # field B already filled stays hidden.
        Account.objects.create(
            username="member3",
            email="member3@gmail.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="26520005",
            full_name="Member Three",
            phone="0955555555",
            school="HCMUT",
            faculty="CNTT",
        )
        Participant.objects.create(
            mssv="26520005",
            full_name="Member Three",
            email="member3@gmail.com",
            phone="0955555555",
            school="HCMUT",
            faculty="CNTT",
            facebook="",  # the only blank
            cccd="012345678905",
            date_of_birth="2006-01-05",
            extra={"gender": "male"},
        )

        payload, error = _member_resolution({"mssv": "26520005", "email": "member3@gmail.com"})

        self.assertIsNone(error)
        field_keys = [field["key"] for field in payload["fields"]]
        # Only the missing field is offered for input, alongside the identity.
        self.assertEqual(set(field_keys), {"mssv", "email", "facebook"})
        self.assertEqual(
            payload["profile"], {"mssv": "26520005", "email": "member3@gmail.com"},
        )

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
            extra={"gender": "female"},
        )

        columns, extra, error = _prepare_member_submission(
            {"mssv": "26520003", "email": "member2@gmail.com"},
            "member",
        )

        self.assertIsNone(error)
        self.assertEqual(columns["full_name"], "Member Two")
        self.assertEqual(columns["cccd"], "012345678901")
        self.assertEqual(columns["date_of_birth"], date(2006, 1, 2))

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
                "gender": "male",
                "facebook": "https://facebook.com/member3",
                "date_of_birth": "2006-01-03",
            },
            "member",
        )

        self.assertEqual(error, "missing:member:cccd")

    def test_patch_team_member_returns_editable_registration_fields_to_captain(self):
        ProgramPhase.objects.create(
            key="registration",
            label="Registration",
            order=1,
            is_current=True,
        )
        SystemSetting.objects.create(key="registration_open", value=True)
        captain_account = Account.objects.create(
            username="captain",
            email="captain@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV001",
        )
        captain = Participant.objects.create(
            account=captain_account,
            mssv="SV001",
            full_name="Captain",
            email="captain@example.com",
            cccd="UIT",
            date_of_birth=date(2005, 1, 1),
        )
        member = Participant.objects.create(
            mssv="SV002",
            full_name="Member",
            email="member@example.com",
            cccd="UIT",
            date_of_birth=date(2005, 1, 2),
        )
        team = Team.objects.create(
            code="T0001",
            name="Draft Team",
            owner_account=captain_account,
            approval_status=Team.APPROVAL_DRAFT,
        )
        TeamMembership.objects.create(team=team, participant=captain, is_captain=True)
        TeamMembership.objects.create(team=team, participant=member, is_captain=False)
        token = generate_session(captain_account)

        response = self.client.patch(
            "/api/my-team/members/SV002",
            data=json.dumps({
                "full_name": "Updated Member",
                "gender": "female",
                "school": "UIT",
                "faculty": "KHMT",
                "email": "member@example.com",
                "phone": "0900000000",
                "cccd": "UIT",
                "date_of_birth": "2006-02-03",
                "facebook": "https://facebook.com/member",
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(response.json()),
            {
                "mssv", "full_name", "school", "email", "phone", "faculty",
                "facebook", "cccd", "date_of_birth", "extra", "is_captain",
                "has_account",
            },
        )
        member.refresh_from_db()
        self.assertEqual(member.date_of_birth, date(2006, 2, 3))
