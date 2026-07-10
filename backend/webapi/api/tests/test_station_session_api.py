import json

from django.test import TestCase

from api.models import (
    Account, Team, ProgramPhase, SubEvent, Station,
    StationSession, ScoreEntry, PhaseRoster,
)
from api.services.auth_service import generate_session


class StationSessionApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin", email="admin@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.collab = Account.objects.create(
            username="coop1", email="coop1@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        self.participant = Account.objects.create(
            username="sv", email="sv@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV001",
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=1, is_current=True,
        )
        self.event = SubEvent.objects.create(
            phase=self.phase, name="Station Run",
            type=SubEvent.TYPE_STATION_RUN, uses_stations=True, order=1,
        )
        self.station1 = Station.objects.create(
            sub_event=self.event, code="VL01", name="Tram 1", order=1,
        )
        self.station2 = Station.objects.create(
            sub_event=self.event, code="VL02", name="Tram 2", order=2,
        )
        self.station_full = Station.objects.create(
            sub_event=self.event, code="VL03", name="Tram day", order=3,
            capacity_mode=Station.CAPACITY_LIMITED, max_concurrent_teams=1,
        )
        self.team1 = Team.objects.create(
            code="T0001", name="Team A", approval_status=Team.APPROVAL_APPROVED, qr_token="t1",
        )
        self.team2 = Team.objects.create(
            code="T0002", name="Team B", approval_status=Team.APPROVAL_APPROVED, qr_token="t2",
        )
        self.team_unrostered = Team.objects.create(
            code="T0003", name="Team C", approval_status=Team.APPROVAL_APPROVED, qr_token="t3",
        )
        self.team_draft = Team.objects.create(
            code="T0004", name="Team D", approval_status=Team.APPROVAL_DRAFT, qr_token="t4",
        )
        for team in (self.team1, self.team2):
            PhaseRoster.objects.create(phase=self.phase, team=team, origin=PhaseRoster.ORIGIN_APPROVED)

    def _enter(self, account, code, station_id):
        token = generate_session(account)
        return self.client.post(
            "/api/station-sessions/enter",
            data=json.dumps({
                "code": code, "stationId": station_id,
                "phaseKey": self.phase.key, "eventId": self.event.id,
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def _exit(self, account, code, station_id, score=None):
        token = generate_session(account)
        body = {"code": code, "stationId": station_id}
        if score is not None:
            body["score"] = score
        return self.client.post(
            "/api/station-sessions/exit",
            data=json.dumps(body),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def test_enter_success(self):
        resp = self._enter(self.collab, self.team1.code, self.station1.id)
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(StationSession.objects.filter(
            station=self.station1, team=self.team1, status=StationSession.STATUS_ACTIVE,
        ).exists())

    def test_enter_team_not_found(self):
        resp = self._enter(self.collab, "NOPE", self.station1.id)
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "team_not_found")

    def test_enter_draft_team_rejected(self):
        resp = self._enter(self.collab, self.team_draft.code, self.station1.id)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "team_not_approved")

    def test_enter_team_not_in_phase(self):
        resp = self._enter(self.collab, self.team_unrostered.code, self.station1.id)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "team_not_in_phase")

    def test_enter_station_full(self):
        self.assertEqual(self._enter(self.collab, self.team1.code, self.station_full.id).status_code, 201)
        resp = self._enter(self.collab, self.team2.code, self.station_full.id)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "station_full")

    def test_enter_same_team_two_stations_blocked(self):
        self.assertEqual(self._enter(self.collab, self.team1.code, self.station1.id).status_code, 201)
        resp = self._enter(self.collab, self.team1.code, self.station2.id)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "session_already_active")

    def test_enter_blocked_when_results_locked(self):
        self.phase.is_current = False
        self.phase.save(update_fields=["is_current"])
        ProgramPhase.objects.create(key="ended", label="Ended", order=2, is_current=True)

        resp = self._enter(self.collab, self.team1.code, self.station1.id)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "results_locked")
        self.assertFalse(StationSession.objects.filter(station=self.station1, team=self.team1).exists())

    def test_exit_success_creates_score_entry(self):
        self._enter(self.collab, self.team1.code, self.station1.id)
        resp = self._exit(self.collab, self.team1.code, self.station1.id, score=10)
        self.assertEqual(resp.status_code, 200)
        session = StationSession.objects.get(station=self.station1, team=self.team1)
        self.assertEqual(session.status, StationSession.STATUS_CLOSED)
        self.assertTrue(ScoreEntry.objects.filter(
            station_session=session, kind=ScoreEntry.KIND_STATION, points=10,
        ).exists())

    def test_exit_session_not_found(self):
        resp = self._exit(self.collab, self.team1.code, self.station1.id)
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "session_not_found")

    def test_exit_blocked_when_results_locked(self):
        self._enter(self.collab, self.team1.code, self.station1.id)
        self.phase.is_current = False
        self.phase.save(update_fields=["is_current"])
        ProgramPhase.objects.create(key="ended", label="Ended", order=2, is_current=True)

        resp = self._exit(self.collab, self.team1.code, self.station1.id, score=10)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "results_locked")
        session = StationSession.objects.get(station=self.station1, team=self.team1)
        self.assertEqual(session.status, StationSession.STATUS_ACTIVE)
        self.assertFalse(ScoreEntry.objects.filter(station_session=session).exists())

    def test_participant_cannot_enter(self):
        resp = self._enter(self.participant, self.team1.code, self.station1.id)
        self.assertIn(resp.status_code, (401, 403))
