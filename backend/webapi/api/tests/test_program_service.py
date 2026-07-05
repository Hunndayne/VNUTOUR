from datetime import date

from django.test import TestCase

from api.models import ProgramPhase, SubEvent
from api.services.program_service import update_phase_dates, update_sub_event


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

    def test_update_sub_event_rejects_blank_name(self):
        phase = ProgramPhase.objects.create(
            key="qualifying",
            label="Qualifying",
            order=2,
        )
        event = SubEvent.objects.create(phase=phase, name="Station Run")

        with self.assertRaises(ValueError) as context:
            update_sub_event(event.id, name="   ")

        self.assertEqual(str(context.exception), "missing_name")
        event.refresh_from_db()
        self.assertEqual(event.name, "Station Run")
