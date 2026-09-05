from django.test import TestCase

from api.models import Participant, ProgramPhase, SystemSetting, Team
from api.services.registration_service import get_schema, register_individual, register_team
from api.services.team_service import set_max_registrations, set_registration_open


def person(mssv: str) -> dict:
    return {
        "full_name": f"Captain {mssv}",
        "gender": "male",
        "school": "UIT",
        "faculty": "KHMT",
        "mssv": mssv,
        "email": f"{mssv.lower()}@example.com",
        "phone": "0900000000",
        "cccd": "UIT",
        "date_of_birth": "2005-01-01",
        "facebook": "https://facebook.com/example",
    }


class RegistrationServiceTests(TestCase):
    def test_legacy_schema_receives_required_gender_field(self):
        SystemSetting.objects.update_or_create(
            key="registration_form_schema",
            defaults={"value": {
                "person_fields": [
                    {"key": "full_name", "label": "Ho ten", "required": True},
                    {"key": "mssv", "label": "MSSV", "required": True},
                ],
            }},
        )

        gender = next(
            field for field in get_schema()["person_fields"] if field["key"] == "gender"
        )

        self.assertTrue(gender["required"])
        self.assertEqual(
            [option["value"] for option in gender["options"]],
            ["male", "female", "other"],
        )

    def test_team_registered_after_registration_phase_is_marked_late_and_pending(self):
        ProgramPhase.objects.create(
            key="qualifying",
            label="Qualifying",
            order=2,
            is_current=True,
        )

        # A one-person team cannot be named — that is reserved for full teams —
        # so it registers unnamed and picks up the placeholder.
        team, error = register_team({
            "captain": person("SV001"),
            "members": [],
        })

        self.assertIsNone(error)
        self.assertIsNotNone(team)
        team.refresh_from_db()
        self.assertEqual(team.approval_status, Team.APPROVAL_PENDING)
        self.assertTrue(team.is_late_registration)
        self.assertIsNotNone(team.submitted_at)
        self.assertEqual(team.name, "Pending team SV001")


class PreloadedMssvClaimTests(TestCase):
    """Registering onto an existing MSSV needs the matching email as proof.

    Registration is unauthenticated, so the student code alone cannot stand in
    for identity — see `_upsert_participant`. These cover the flow the guard has
    to keep working: organisers preload a roster, students then self-register.
    """

    def test_matching_email_updates_the_preloaded_record(self):
        Participant.objects.create(mssv="SV100", full_name="Ho So Nap Truoc",
                                   email="sv100@example.com")

        participant, error = register_individual(person("SV100"))

        self.assertIsNone(error)
        self.assertEqual(participant.full_name, "Captain SV100")

    def test_a_different_email_is_refused(self):
        Participant.objects.create(mssv="SV101", full_name="Chu Nhan That",
                                   email="chunhan@example.com")

        participant, error = register_individual({
            **person("SV101"), "email": "kegian@example.com",
        })

        self.assertIsNone(participant)
        self.assertEqual(error, "mssv_email_mismatch:SV101")
        self.assertEqual(
            Participant.objects.get(mssv="SV101").full_name, "Chu Nhan That",
        )

    def test_a_preloaded_record_without_an_email_stays_claimable(self):
        """Nothing to match against, so the guard must not lock it out."""
        Participant.objects.create(mssv="SV102", full_name="Chua Co Email", email="")

        participant, error = register_individual(person("SV102"))

        self.assertIsNone(error)
        self.assertEqual(participant.email, "sv102@example.com")

    def test_a_brand_new_mssv_is_unaffected(self):
        participant, error = register_individual(person("SV103"))

        self.assertIsNone(error)
        self.assertEqual(participant.mssv, "SV103")


class TeamNamingRuleTests(TestCase):
    """Only a full team may choose its own name."""

    def _members(self, count):
        return [person(f"SV2{i:02d}") for i in range(count)]

    def test_a_full_team_must_be_named(self):
        team, error = register_team({
            "captain": person("SV200"),
            "members": self._members(4),
        })

        self.assertIsNone(team)
        self.assertEqual(error, "missing:team:team_name")

    def test_a_full_team_keeps_the_name_it_chose(self):
        team, error = register_team({
            "team_name": "Doi Ngu Manh",
            "captain": person("SV210"),
            "members": [person(f"SV2{i:02d}") for i in range(11, 15)],
        })

        self.assertIsNone(error)
        self.assertEqual(team.name, "Doi Ngu Manh")

    def test_an_under_strength_team_may_not_choose_a_name(self):
        team, error = register_team({
            "team_name": "Ten Dat Som",
            "captain": person("SV220"),
            "members": [person("SV221")],
        })

        self.assertIsNone(team)
        self.assertEqual(error, "team_name_requires_full_team:5")

    def test_an_under_strength_team_registers_fine_without_a_name(self):
        team, error = register_team({
            "captain": person("SV230"),
            "members": [person("SV231")],
        })

        self.assertIsNone(error)
        self.assertEqual(team.name, "Pending team SV230")


class CapacityLimitingTests(TestCase):
    def setUp(self):
        set_registration_open(True)

    def test_individual_registration_does_not_consume_capacity(self):
        # The cap counts members of submitted teams only. A lone registrant is
        # not on a submitted team, so they never fill a slot — registration
        # stays open however many register individually.
        set_max_registrations(2)
        for mssv in ("SV301", "SV302", "SV303"):
            p, err = register_individual(person(mssv))
            self.assertIsNone(err)
            self.assertIsNotNone(p)

    def test_team_registration_blocked_when_exceeding_remaining(self):
        # A submitted team consumes one slot per member. 4 spots total.
        set_max_registrations(4)

        # A team of 2 takes 2 of the 4 slots.
        team_a, err_a = register_team({
            "captain": person("SV310"), "members": [person("SV311")],
        })
        self.assertIsNone(err_a)
        self.assertIsNotNone(team_a)

        # A team of 3 needs 3 more, but only 2 remain -> blocked.
        team_b, err_b = register_team({
            "captain": person("SV312"),
            "members": [person("SV313"), person("SV314")],
        })
        self.assertIsNone(team_b)
        self.assertEqual(err_b, "registration_capacity_reached")

        # A team of 2 fits exactly into the 2 remaining slots.
        team_c, err_c = register_team({
            "captain": person("SV315"), "members": [person("SV316")],
        })
        self.assertIsNone(err_c)
        self.assertIsNotNone(team_c)

    def test_zero_capacity_allows_unlimited(self):
        set_max_registrations(0)
        p, err = register_individual(person("SV320"))
        self.assertIsNone(err)
        self.assertIsNotNone(p)

    def test_views_return_registration_full_and_block_post(self):
        set_max_registrations(2)
        # A submitted team of 2 fills the cap.
        register_team({"captain": person("SV330"), "members": [person("SV331")]})

        # schema_view has registration_full = True
        resp = self.client.get("/api/register/schema")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["registration_full"])

        # POST /api/register/individual returns 403
        resp_ind = self.client.post(
            "/api/register/individual",
            data=person("SV332"),
            content_type="application/json",
        )
        self.assertEqual(resp_ind.status_code, 403)
        self.assertEqual(resp_ind.json()["error"], "registration_capacity_reached")

        # POST /api/register/team returns 403
        resp_team = self.client.post(
            "/api/register/team",
            data={"captain": person("SV333"), "members": []},
            content_type="application/json",
        )
        self.assertEqual(resp_team.status_code, 403)
        self.assertEqual(resp_team.json()["error"], "registration_capacity_reached")

