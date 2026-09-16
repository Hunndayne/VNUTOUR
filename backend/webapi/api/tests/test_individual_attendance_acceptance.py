"""Independent API acceptance checks for personal QR attendance and team entry."""
import json
import tempfile
from pathlib import Path

from django.test import override_settings

from api.models import (
    Account, EventAttendance, EventCheckIn, Participant, PhaseRoster, Station,
    SubEvent, SystemSetting, Team, TeamMembership,
)
from api.services.auth_service import generate_session
from api.tests.test_station_journey_replay import StationJourneyTestBase


class IndividualAttendanceTestBase(StationJourneyTestBase):
    def setUp(self):
        super().setUp()
        self.event.require_checkin = True
        self.event.checkin_mode = "individual"
        self.event.min_checkin_members = 2
        self.event.save()
        SystemSetting.objects.update_or_create(key="current_sub_event_id", defaults={"value": str(self.event.id)})
        SystemSetting.objects.update_or_create(key="checkin_qr", defaults={"value": {
            "enabled": True, "phase_key": self.phase.key, "rotated_at": "2026-09-15T00:00:00Z",
        }})
        self.a = self._member("A", self.team)
        self.b = self._member("B", self.team)
        self.other = Team.objects.create(code="T0002", name="Other", approval_status=Team.APPROVAL_APPROVED)
        PhaseRoster.objects.create(team=self.other, phase=self.phase)
        self.c = self._member("C", self.other)
        self.play = Station.objects.create(sub_event=self.event, code="P", name="Play")
        self.free = Station.objects.create(sub_event=self.event, code="F", name="Free",
            checkin_policy=Station.POLICY_FREE_PLAY,
            submission_config={"items": [{"id": "q", "type": "text", "label": "Answer"}]})
        self.checkout = Station.objects.create(sub_event=self.event, code="OUT", name="Checkout", kind=Station.KIND_CHECKOUT)

    def _member(self, name, team):
        account = Account.objects.create(username=name, mssv=name, email=f"{name}@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT)
        participant = Participant.objects.create(account=account, mssv=name, full_name=f"Member {name}")
        TeamMembership.objects.create(team=team, participant=participant)
        return account

    def _request(self, account, path, body=None):
        auth = {"HTTP_AUTHORIZATION": f"Bearer {generate_session(account)}"}
        if body is None:
            return self.client.get(path, **auth)
        return self.client.post(path, data=json.dumps(body), content_type="application/json", **auth)

    def _qr(self, account):
        response = self._request(account, "/api/my/checkin-qr")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def _scan(self, code):
        return self._request(self.admin, "/api/station-scan", {"code": code})


class IndividualAttendanceAcceptanceTests(IndividualAttendanceTestBase):
    def test_distinct_personal_scans_unlock_only_their_team_at_threshold(self):
        qa, qb, qc = [self._qr(account) for account in (self.a, self.b, self.c)]
        self.assertNotEqual(qa["payload"], qb["payload"])
        self.assertTrue(qa["payload"].startswith("p:"))
        first = self._scan(qa["payload"])
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(first.json()["mssv"], "A")
        self.assertEqual(first.json()["checked_in_count"], 1)
        self.assertFalse(first.json()["eligible"])
        self.assertEqual(self._enter(self.play).status_code, 409)
        self.assertEqual(self._request(self.a, f"/api/my-team/forms/{self.free.id}/start", {}).status_code, 409)
        self.assertEqual(self._scan(qc["payload"]).status_code, 201)
        self.assertEqual(self._enter(self.play).status_code, 409)
        self.assertEqual(self._scan(qa["payload"]).status_code, 409)
        self.assertEqual(EventAttendance.objects.count(), 2)
        second = self._scan(qb["payload"])
        self.assertEqual(second.status_code, 201, second.content)
        self.assertTrue(second.json()["eligible"])
        self.assertEqual(second.json()["checked_in_count"], 2)
        self.assertEqual(self._enter(self.play).status_code, 201)
        own = self._qr(self.a)
        self.assertTrue(own["checked_in"])
        self.assertFalse(own.get("payload"))
        self.assertEqual(self._enter(self.play, team=self.other).status_code, 409)

    def test_team_checkout_does_not_require_personal_attendance(self):
        response = self._scan(f"{self.team.code}|s:{self.checkout.id}|d:in")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(EventAttendance.objects.count(), 0)
        stats = self._request(self.admin, f"/api/event-checkins/stats?event_id={self.event.id}").json()
        self.assertEqual(stats["checked_in_teams"], 0)
        self.assertEqual(stats["checked_in_participants"], 0)
        self.assertTrue(self._qr(self.a)["checked_out"])
        self.assertEqual(self._enter(self.play).json()["error"], "team_checked_out")

    def test_team_mode_preserves_one_scan_for_team_and_ignores_member_threshold(self):
        self.event.checkin_mode = "team"
        self.event.min_checkin_members = 99
        self.event.save()
        qa, qb = self._qr(self.a), self._qr(self.b)
        self.assertEqual(qa["mode"], "team")
        self.assertEqual(qa["payload"], qb["payload"])
        self.assertTrue(qa["payload"].startswith("t:"))
        response = self._scan(qa["payload"])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(self._qr(self.b)["checked_in"])
        self.assertEqual(EventAttendance.objects.count(), 0)
        self.assertEqual(self._enter(self.play).status_code, 201)

    def test_undo_checkout_without_checkin_does_not_unlock_team_mode(self):
        self.event.checkin_mode = "team"
        self.event.save()
        response = self._scan(f"{self.team.code}|s:{self.checkout.id}|d:in")
        self.assertEqual(response.status_code, 201, response.content)
        token = generate_session(self.admin)
        undone = self.client.delete(f'/api/event-checkins/{response.json()["id"]}?scope=checkout',
            HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(undone.status_code, 200)
        self.assertFalse(self._qr(self.a)["checked_in"])
        self.assertEqual(self._enter(self.play).status_code, 409)
        stats = self._request(self.admin, f"/api/event-checkins/stats?event_id={self.event.id}").json()
        self.assertEqual(stats["checked_in_teams"], 0)

    def test_legacy_team_header_never_fabricates_individual_attendance(self):
        EventCheckIn.objects.create(team=self.team, sub_event=self.event, phase=self.phase, scanner=self.admin)
        self.assertEqual(self._qr(self.a)["checked_in_count"], 0)
        self.assertEqual(self._enter(self.play).status_code, 409)
        response = self._scan(self._qr(self.a)["payload"])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(EventCheckIn.objects.count(), 1)

    def test_reset_removes_eligibility_and_allows_person_to_check_in_again(self):
        self._scan(self._qr(self.a)["payload"])
        self._scan(self._qr(self.b)["payload"])
        header = EventCheckIn.objects.get(team=self.team)
        token = generate_session(self.admin)
        response = self.client.delete(f"/api/event-checkins/{header.id}", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._qr(self.b)["checked_in_count"], 0)
        self.assertEqual(self._enter(self.play).status_code, 409)
        response = self._scan(self._qr(self.a)["payload"])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["checked_in_count"], 1)
        self.assertEqual(EventAttendance.objects.count(), 3)

    def test_personal_qr_is_bound_to_event_and_cannot_open_play_station(self):
        code = self._qr(self.a)["payload"]
        play_scan = self._scan(f"{code}|s:{self.play.id}|d:in")
        self.assertGreaterEqual(play_scan.status_code, 400)
        self.assertEqual(EventAttendance.objects.count(), 0)
        other_event = SubEvent.objects.create(phase=self.phase, name="Next", require_checkin=True,
            checkin_mode="individual", min_checkin_members=1)
        SystemSetting.objects.filter(key="current_sub_event_id").update(value=str(other_event.id))
        stale = self._scan(code)
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertEqual(EventAttendance.objects.count(), 0)
        fresh = self._scan(self._qr(self.a)["payload"])
        self.assertEqual(fresh.status_code, 201, fresh.content)
        self.assertEqual(EventAttendance.objects.get().checkin.sub_event_id, other_event.id)

    def test_backup_restores_actual_individual_records(self):
        from api.services.backup_service import create_backup, restore_backup
        self._scan(self._qr(self.a)["payload"])
        with tempfile.TemporaryDirectory() as directory:
            with override_settings(BACKUP_ROOT=directory, MEDIA_ROOT=str(Path(directory) / "media")):
                saved = create_backup()
                EventAttendance.objects.all().delete()
                restore_backup(archive_path=Path(directory) / saved["filename"], actor=self.admin)
        self.assertEqual(EventAttendance.objects.get().participant.mssv, "A")
        self.assertEqual(self._qr(self.b)["checked_in_count"], 1)

    def test_report_does_not_list_absent_people_as_individual_checkins(self):
        import io
        import zipfile
        self._scan(self._qr(self.a)["payload"])
        response = self._request(self.admin, "/api/admin/reports/export.xlsx")
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.content)) as workbook:
            sheet = workbook.read("xl/worksheets/sheet3.xml").decode("utf-8")
        self.assertIn("Member A", sheet)
        self.assertNotIn("Member B", sheet)

    def test_qr_identity_cannot_be_selected_by_query_and_scans_require_staff(self):
        response = self._request(self.a, f"/api/my/checkin-qr?participant_id={self.b.id}")
        self.assertEqual(response.json()["mssv"], "A")
        code = response.json()["payload"]
        self.assertEqual(self._request(self.b, "/api/station-scan", {"code": code}).status_code, 403)
        self.assertEqual(self.client.get("/api/my/checkin-qr").status_code, 401)
        self.assertEqual(self._request(self.admin, "/api/my/checkin-qr").status_code, 403)
        self.assertEqual(EventAttendance.objects.count(), 0)

    def test_forged_rotated_or_wrong_mode_qrs_cannot_record_presence(self):
        code = self._qr(self.a)["payload"]
        self.assertEqual(self._scan(code + "tampered").status_code, 400)
        self.assertEqual(self._scan(self.team.code).json()["error"], "personal_qr_required")
        SystemSetting.objects.filter(key="checkin_qr").update(value={
            "enabled": False, "phase_key": self.phase.key, "rotated_at": "new",
        })
        self.assertTrue(self._qr(self.a)["enabled"])
        self.assertEqual(self._scan(code).json()["error"], "invalid_personal_qr")
        self.assertEqual(EventAttendance.objects.count(), 0)

    def test_actual_stats_and_unchecked_members_are_distinguished(self):
        self._scan(self._qr(self.a)["payload"])
        stats = self._request(self.admin, f"/api/event-checkins/stats?event_id={self.event.id}").json()
        self.assertEqual(stats["checked_in_teams"], 1)
        self.assertEqual(stats["checked_in_participants"], 1)
        members = self._request(self.admin, f"/api/event-checkins?event_id={self.event.id}").json()["items"][0]["members_detail"]
        self.assertEqual({m["mssv"]: m["checked_in"] for m in members}, {"A": True, "B": False})

    def test_team_mode_can_check_in_after_undoing_checkout_only(self):
        self.event.checkin_mode = "team"
        self.event.save()
        response = self._scan(f"{self.team.code}|s:{self.checkout.id}|d:in")
        token = generate_session(self.admin)
        self.client.delete(f'/api/event-checkins/{response.json()["id"]}?scope=checkout',
            HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(self._scan(self._qr(self.a)["payload"]).status_code, 201)
        self.assertEqual(self._enter(self.play).status_code, 201)

    def test_event_configuration_roundtrip_and_rejects_invalid_values(self):
        self.admin.role = Account.ROLE_MASTER_ADMIN
        self.admin.save()
        response = self._request(self.admin, f"/api/program/phases/{self.phase.key}/sub-events", {
            "name": "New", "uses_stations": True, "require_checkin": True,
            "checkin_mode": "individual", "min_checkin_members": 3,
        })
        self.assertEqual(response.status_code, 201, response.content)
        event_id = response.json()["id"]
        self.assertEqual(response.json()["min_checkin_members"], 3)
        for key, values in {
            "checkin_mode": ["invalid", None, [], True],
            "min_checkin_members": [0, -1, 1.5, True, None, 2147483648],
        }.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    token = generate_session(self.admin)
                    result = self.client.patch(f"/api/program/sub-events/{event_id}",
                        data=json.dumps({key: value}), content_type="application/json",
                        HTTP_AUTHORIZATION=f"Bearer {token}")
                    self.assertEqual(result.status_code, 400, result.content)
        saved = SubEvent.objects.get(id=event_id)
        self.assertEqual(saved.checkin_mode, "individual")
        self.assertEqual(saved.min_checkin_members, 3)
