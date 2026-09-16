"""Attendance opens and closes with the running event, without a QR toggle."""
from api.models import EventCheckIn, PhaseRoster, Station, SubEvent, SystemSetting, Team
from api.tests.test_individual_attendance_acceptance import IndividualAttendanceTestBase


class AttendanceEventLifecycleTests(IndividualAttendanceTestBase):
    def test_running_event_issues_and_accepts_qr_without_admin_toggle(self):
        for mode in ("individual", "team"):
            for legacy in (None, {"enabled": False, "phase_key": "old-phase"}):
                with self.subTest(mode=mode, legacy=legacy):
                    EventCheckIn.objects.all().delete()
                    self.event.checkin_mode = mode
                    self.event.save()
                    SystemSetting.objects.filter(key="checkin_qr").delete()
                    if legacy is not None:
                        SystemSetting.objects.create(key="checkin_qr", value=legacy)
                    qr = self._qr(self.a)
                    self.assertTrue(qr["enabled"], qr)
                    self.assertTrue(qr["payload"])
                    response = self._scan(qr["payload"])
                    self.assertEqual(response.status_code, 201, response.content)

    def test_closing_event_rejects_cached_qr_on_every_scan_route(self):
        gate = Station.objects.create(sub_event=self.event, code="IN", name="Entrance", kind=Station.KIND_CHECKIN)
        for mode in ("individual", "team"):
            self.event.checkin_mode = mode
            self.event.save()
            SystemSetting.objects.update_or_create(key="current_sub_event_id", defaults={"value": str(self.event.id)})
            code = self._qr(self.a)["payload"]
            SystemSetting.objects.filter(key="current_sub_event_id").delete()
            qr = self._request(self.a, "/api/my/checkin-qr")
            self.assertEqual(qr.json()["error"], "no_current_event")
            for path, body in (
                ("/api/station-scan", {"code": code}),
                ("/api/station-scan", {"code": f"{code}|s:{gate.id}|d:in"}),
                ("/api/event-checkins/scan", {"code": code, "phaseKey": self.phase.key, "eventId": self.event.id}),
                ("/api/event-checkins/scan", {"code": self.team.code, "phaseKey": self.phase.key, "eventId": self.event.id}),
            ):
                with self.subTest(mode=mode, path=path, body=body):
                    response = self._request(self.admin, path, body)
                    self.assertEqual(response.status_code, 409, response.content)
                    self.assertEqual(response.json()["error"], "no_current_event")
        self.assertFalse(EventCheckIn.objects.exists())

    def test_explicit_scan_cannot_target_an_event_that_is_not_running(self):
        other = SubEvent.objects.create(phase=self.phase, name="Closed event")
        response = self._request(self.admin, "/api/event-checkins/scan", {
            "code": self.team.code, "phaseKey": self.phase.key, "eventId": other.id,
        })
        self.assertEqual(response.status_code, 409, response.content)
        self.assertFalse(EventCheckIn.objects.exists())

    def test_no_toggle_does_not_bypass_approval_or_roster(self):
        SystemSetting.objects.filter(key="checkin_qr").delete()
        self.team.approval_status = Team.APPROVAL_PENDING
        self.team.save()
        self.assertFalse(self._qr(self.a)["enabled"])
        self.team.approval_status = Team.APPROVAL_APPROVED
        self.team.save()
        PhaseRoster.objects.filter(team=self.team).delete()
        self.assertFalse(self._qr(self.a)["enabled"])

    def test_running_event_without_roster_accepts_teams_in_current_phase(self):
        SystemSetting.objects.filter(key="checkin_qr").delete()
        PhaseRoster.objects.all().delete()
        code = self._qr(self.a)["payload"]
        self.assertTrue(code)
        response = self._scan(code)
        self.assertEqual(response.status_code, 201, response.content)

    def test_reopening_event_restores_qr_without_admin_toggle(self):
        SystemSetting.objects.filter(key="checkin_qr").delete()
        SystemSetting.objects.filter(key="current_sub_event_id").delete()
        self.assertEqual(self._request(self.a, "/api/my/checkin-qr").status_code, 409)
        SystemSetting.objects.create(key="current_sub_event_id", value=self.event.id)
        code = self._qr(self.a)["payload"]
        self.assertTrue(code)
        self.assertEqual(self._scan(code).status_code, 201)
