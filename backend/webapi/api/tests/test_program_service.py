from datetime import date

from django.test import TestCase

from api.models import ProgramPhase
from api.services.program_service import update_phase_dates


class ProgramServiceTests(TestCase):
    def test_update_phase_dates_normalizes_input_strings(self):
        ProgramPhase.objects.create(
            key="registration",
            label="Registration",
            order=1,
        )

        phase = update_phase_dates(
            "registration",
            start_date="2026-09-03",
            end_date="2026-09-14",
        )

        self.assertEqual(phase.start_date, date(2026, 9, 3))
        self.assertEqual(phase.end_date, date(2026, 9, 14))
