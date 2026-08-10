"""The one scan that does everything.

The coop screen used to make a human pick the station from a dropdown and flip
an enter/exit switch before scanning — two things to get wrong on a busy day.
Now the QR carries the station and the direction, so `/api/station-scan` reads
both from the code. These pin that: the right station and direction land
automatically, and only a coop posted to a station may scan it there.
"""

import json

from django.test import TestCase

from api.models import (
    Account, PhaseRoster, ProgramPhase, Station, StationAssignment,
    StationSession, SubEvent, SystemSetting, Team,
)
from api.services import scan_token_service as scan
from api.services.auth_service import generate_session


class ParseScanTests(TestCase):
    def test_a_bare_event_token_carries_no_station_or_direction(self):
        token, station_id, direction = scan.parse_scan("t:abc")
        self.assertEqual(token, "t:abc")
        self.assertIsNone(station_id)
        self.assertIsNone(direction)

    def test_a_station_code_is_split_into_its_three_parts(self):
        token, station_id, direction = scan.parse_scan("t:abc|s:7|d:out")
        self.assertEqual(token, "t:abc")
        self.assertEqual(station_id, 7)
        self.assertEqual(direction, "out")

    def test_a_garbled_station_segment_is_ignored_not_fatal(self):
        token, station_id, direction = scan.parse_scan("t:abc|s:notanumber|d:sideways")
        self.assertEqual(token, "t:abc")
        self.assertIsNone(station_id)
        self.assertIsNone(direction)


class StationScanTestBase(TestCase):
    def setUp(self):
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Vong loai", order=2, is_current=True,
        )
        self.event = SubEvent.objects.create(phase=self.phase, name="Chay tram")
        self.station = Station.objects.create(
            sub_event=self.event, code="S01", name="Tram 1", order=1,
            checkin_policy=Station.POLICY_STAFF_SCAN,
        )
        self.other_station = Station.objects.create(
            sub_event=self.event, code="S02", name="Tram 2", order=2,
            checkin_policy=Station.POLICY_STAFF_SCAN,
        )
        self.team = Team.objects.create(
            code="T0001", name="Doi A",
            approval_status=Team.APPROVAL_APPROVED, qr_token="tok-1",
        )
        PhaseRoster.objects.create(phase=self.phase, team=self.team)
        SystemSetting.objects.update_or_create(
            key="current_sub_event_id", defaults={"value": str(self.event.id)},
        )
        SystemSetting.objects.update_or_create(
            key="checkin_qr",
            defaults={"value": {"enabled": True, "phase_key": self.phase.key}},
        )

        self.coop = Account.objects.create(
            username="coop1", email="coop1@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        StationAssignment.objects.create(collab=self.coop, station=self.station, active=True)
        self.admin = Account.objects.create(
            username="admin", email="admin@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )

    def _scan(self, code, *, actor=None):
        actor = actor or self.coop
        return self.client.post(
            "/api/station-scan",
            data=json.dumps({"code": code}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(actor)}",
        )

    def _qr(self, station, direction):
        self.team.refresh_from_db()
        return f"t:{self.team.qr_token}|s:{station.id}|d:{direction}"


class StationScanFlowTests(StationScanTestBase):
    def test_the_station_and_direction_come_from_the_code_not_the_coop(self):
        response = self._scan(self._qr(self.station, "in"))

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["kind"], "enter")
        self.assertEqual(body["station_code"], self.station.code)
        session = StationSession.objects.get(team=self.team, station=self.station)
        self.assertEqual(session.status, StationSession.STATUS_ACTIVE)

    def test_a_check_out_code_closes_the_session(self):
        self._scan(self._qr(self.station, "in"))

        response = self._scan(self._qr(self.station, "out"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["kind"], "exit")
        session = StationSession.objects.get(team=self.team, station=self.station)
        self.assertEqual(session.status, StationSession.STATUS_CLOSED)

    def test_a_coop_cannot_scan_a_station_they_are_not_posted_to(self):
        """The coop is assigned to station 1; the code names station 2."""
        response = self._scan(self._qr(self.other_station, "in"))

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "not_assigned_to_station")
        self.assertFalse(
            StationSession.objects.filter(team=self.team, station=self.other_station).exists(),
        )

    def test_an_admin_may_scan_any_station(self):
        response = self._scan(self._qr(self.other_station, "in"), actor=self.admin)

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            StationSession.objects.filter(team=self.team, station=self.other_station).exists(),
        )

    def test_a_bare_event_token_checks_into_the_running_sub_event(self):
        self.team.refresh_from_db()
        response = self._scan(f"t:{self.team.qr_token}", actor=self.admin)

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["kind"], "event")
        self.assertEqual(body["event_name"], self.event.name)

    def test_a_re_read_of_the_entry_code_is_refused(self):
        """The single-use token still guards the double-scan the QR carries now."""
        code = self._qr(self.station, "in")
        self._scan(code)

        response = self._scan(code)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "qr_already_used")
        self.assertEqual(
            StationSession.objects.filter(team=self.team, station=self.station).count(), 1,
        )
