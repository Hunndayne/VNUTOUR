"""A scanned QR stops working once it has been used.

Last year a coop phone re-read the QR still open on a participant's screen and
checked the team in twice. These pin the fix: the token rotates on success, so
the second read resolves to nothing instead of repeating the action.
"""

from django.test import TestCase

from api.models import (
    Account, PhaseRoster, ProgramPhase, Station, StationSession, SubEvent,
    SystemSetting, Team,
)
from api.services import scan_token_service as scan
from api.services.checkin_service import scan_event_checkin
from api.services.station_service import enter_station, exit_station


class ScanTokenTestBase(TestCase):
    def setUp(self):
        self.operator = Account.objects.create(
            username="coop", email="coop@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Vong loai", order=2, is_current=True,
        )
        self.event = SubEvent.objects.create(phase=self.phase, name="Chay tram")
        self.station = Station.objects.create(
            sub_event=self.event, code="S01", name="Tram 1",
            checkin_policy=Station.POLICY_STAFF_SCAN,
        )
        self.team = Team.objects.create(
            code="T0001", name="Doi A",
            approval_status=Team.APPROVAL_APPROVED, qr_token="tok-original",
        )
        PhaseRoster.objects.create(phase=self.phase, team=self.team)
        # The QR gate only lets `t:` scans through while check-in is switched on.
        SystemSetting.objects.update_or_create(
            key="checkin_qr",
            defaults={"value": {"enabled": True, "phase_key": self.phase.key}},
        )

    def _qr(self):
        self.team.refresh_from_db()
        return f"t:{self.team.qr_token}"


class EventCheckinScanTests(ScanTokenTestBase):
    def test_a_successful_scan_retires_the_code(self):
        code = self._qr()

        checkin, error = scan_event_checkin(code, self.phase.key, self.event.id, self.operator)

        self.assertIsNone(error)
        self.assertIsNotNone(checkin)
        self.team.refresh_from_db()
        self.assertNotEqual(self.team.qr_token, "tok-original")

    def test_re_reading_the_same_image_is_refused(self):
        """The exact failure from last year: one QR, two reads."""
        code = self._qr()
        scan_event_checkin(code, self.phase.key, self.event.id, self.operator)

        _, error = scan_event_checkin(code, self.phase.key, self.event.id, self.operator)

        self.assertEqual(error, scan.ERROR_QR_SPENT)

    def test_a_rejected_scan_leaves_the_code_usable(self):
        """Burning a token on a scan that never happened would just confuse people."""
        code = self._qr()
        other_event = SubEvent.objects.create(phase=self.phase, name="Su kien khac")
        SubEvent.objects.filter(id=other_event.id).update(phase=self.phase)
        self.team.approval_status = Team.APPROVAL_PENDING
        self.team.save(update_fields=["approval_status"])

        _, error = scan_event_checkin(code, self.phase.key, self.event.id, self.operator)
        self.assertEqual(error, "team_not_approved")

        self.team.refresh_from_db()
        self.assertEqual(self.team.qr_token, "tok-original")

    def test_a_typed_team_code_does_not_rotate_the_qr(self):
        """No camera can re-read a keyed-in code, and the team's QR stays live."""
        checkin, error = scan_event_checkin(
            self.team.code, self.phase.key, self.event.id, self.operator,
        )

        self.assertIsNone(error)
        self.assertIsNotNone(checkin)
        self.team.refresh_from_db()
        self.assertEqual(self.team.qr_token, "tok-original")

    def test_an_unknown_string_is_reported_as_a_missing_team(self):
        _, error = scan_event_checkin("khong-ton-tai", self.phase.key, self.event.id, self.operator)

        self.assertEqual(error, scan.ERROR_TEAM_NOT_FOUND)


class StationSessionScanTests(ScanTokenTestBase):
    def test_entering_a_station_retires_the_code(self):
        code = self._qr()

        session, error = enter_station(
            code, self.station.id, self.phase.key, self.event.id, self.operator,
        )

        self.assertIsNone(error)
        self.assertEqual(session.status, StationSession.STATUS_ACTIVE)
        self.team.refresh_from_db()
        self.assertNotEqual(self.team.qr_token, "tok-original")

    def test_re_reading_the_entry_code_is_refused(self):
        code = self._qr()
        enter_station(code, self.station.id, self.phase.key, self.event.id, self.operator)

        _, error = enter_station(
            code, self.station.id, self.phase.key, self.event.id, self.operator,
        )

        self.assertEqual(error, scan.ERROR_QR_SPENT)
        self.assertEqual(
            StationSession.objects.filter(team=self.team, station=self.station).count(), 1,
        )

    def test_exiting_needs_the_new_code_and_retires_it_too(self):
        enter_station(
            self._qr(), self.station.id, self.phase.key, self.event.id, self.operator,
        )
        exit_code = self._qr()

        session, error = exit_station(exit_code, self.station.id, self.operator)

        self.assertIsNone(error)
        self.assertEqual(session.status, StationSession.STATUS_CLOSED)
        self.team.refresh_from_db()
        self.assertNotEqual(scan.strip_prefix(exit_code), self.team.qr_token)

    def test_the_entry_code_cannot_be_reused_to_exit(self):
        """Each scan consumes its own code, so in and out are never the same image."""
        entry_code = self._qr()
        enter_station(entry_code, self.station.id, self.phase.key, self.event.id, self.operator)

        _, error = exit_station(entry_code, self.station.id, self.operator)

        self.assertEqual(error, scan.ERROR_QR_SPENT)
        self.assertTrue(
            StationSession.objects.filter(
                team=self.team, station=self.station,
                status=StationSession.STATUS_ACTIVE,
            ).exists(),
        )

    def test_a_failed_exit_leaves_the_code_usable(self):
        code = self._qr()

        _, error = exit_station(code, self.station.id, self.operator)

        self.assertEqual(error, "session_not_found")
        self.team.refresh_from_db()
        self.assertEqual(self.team.qr_token, "tok-original")


class ResolveTeamTests(ScanTokenTestBase):
    def test_a_spent_qr_is_told_apart_from_an_unknown_one(self):
        """The two need different words in front of a queue."""
        team, error = scan.resolve_team("t:khong-con-nua")
        self.assertIsNone(team)
        self.assertEqual(error, scan.ERROR_QR_SPENT)

        team, error = scan.resolve_team("hoan-toan-la")
        self.assertIsNone(team)
        self.assertEqual(error, scan.ERROR_TEAM_NOT_FOUND)

    def test_both_prefix_cases_resolve(self):
        for prefix in ("t:", "T:"):
            with self.subTest(prefix=prefix):
                team, error = scan.resolve_team(f"{prefix}tok-original")
                self.assertIsNone(error)
                self.assertEqual(team.id, self.team.id)
