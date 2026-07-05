from django.test import TestCase

from api.models import ProgramPhase, Team
from api.services.registration_service import register_team


def person(mssv: str) -> dict:
    return {
        "full_name": f"Captain {mssv}",
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
    def test_team_registered_after_registration_phase_is_marked_late_and_pending(self):
        ProgramPhase.objects.create(
            key="qualifying",
            label="Qualifying",
            order=2,
            is_current=True,
        )

        team, error = register_team({
            "team_name": "Late Team",
            "captain": person("SV001"),
            "members": [],
        })

        self.assertIsNone(error)
        self.assertIsNotNone(team)
        team.refresh_from_db()
        self.assertEqual(team.approval_status, Team.APPROVAL_PENDING)
        self.assertTrue(team.is_late_registration)
        self.assertIsNotNone(team.submitted_at)
