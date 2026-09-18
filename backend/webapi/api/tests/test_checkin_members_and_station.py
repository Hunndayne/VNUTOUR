"""Checked-in member names on scans, and the auto-created check-in station."""
from api.models import ProgramPhase, Station, SubEvent
from api.services.program_service import create_sub_event, update_sub_event
from api.tests.test_individual_attendance_acceptance import IndividualAttendanceTestBase


class CheckedInMembersOnScanTests(IndividualAttendanceTestBase):
    def _names(self, response):
        return [m["full_name"] for m in response.json()["checked_in_members"]]

    def test_personal_scan_lists_only_members_already_checked_in(self):
        first = self._scan(self._qr(self.a)["payload"])
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(self._names(first), ["Member A"])

        second = self._scan(self._qr(self.b)["payload"])
        self.assertEqual(self._names(second), ["Member A", "Member B"])

    def test_station_entry_scan_lists_checked_in_members_only(self):
        self.event.min_checkin_members = 1
        self.event.save()
        self._member("D", self.team)  # never checks in
        self._scan(self._qr(self.a)["payload"])
        self.team.refresh_from_db()
        response = self._scan(f"t:{self.team.qr_token}|s:{self.play.id}|d:in")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["kind"], "enter")
        self.assertEqual(self._names(response), ["Member A"])
        self.assertNotIn("Member D", self._names(response))

    def test_team_mode_lists_every_member_once_team_checked_in(self):
        self.event.checkin_mode = SubEvent.CHECKIN_TEAM
        self.event.save()
        response = self._scan(f"t:{self.team.qr_token}")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(sorted(self._names(response)), ["Member A", "Member B"])


class AutoCheckinStationTests(IndividualAttendanceTestBase):
    def setUp(self):
        super().setUp()
        self.qualifying = ProgramPhase.objects.get(id=self.phase.id)

    def _checkin_stations(self, event):
        return Station.objects.filter(sub_event=event, kind=Station.KIND_CHECKIN)

    def test_create_event_with_checkin_gets_one_station(self):
        event = create_sub_event(self.qualifying.key, "Ngày hội", require_checkin=True)
        stations = list(self._checkin_stations(event))
        self.assertEqual(len(stations), 1)
        self.assertEqual(stations[0].code, "CHECKIN")
        self.assertTrue(stations[0].active)

    def test_event_without_checkin_gets_none(self):
        event = create_sub_event(self.qualifying.key, "Không điểm danh")
        self.assertFalse(self._checkin_stations(event).exists())

    def test_enabling_checkin_later_creates_once_and_avoids_code_clash(self):
        event = create_sub_event(self.qualifying.key, "Sau")
        Station.objects.create(sub_event=event, code="CHECKIN", name="Play named CHECKIN")
        update_sub_event(event.id, require_checkin=True)
        update_sub_event(event.id, name="Sau nữa")
        stations = list(self._checkin_stations(event))
        self.assertEqual([s.code for s in stations], ["CHECKIN-2"])

    def test_existing_inactive_checkin_station_is_not_recreated(self):
        event = create_sub_event(self.qualifying.key, "Tắt", require_checkin=True)
        self._checkin_stations(event).update(active=False)
        update_sub_event(event.id, name="Tắt 2")
        self.assertEqual(self._checkin_stations(event).count(), 1)
