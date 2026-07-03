import json

from django.test import TestCase
from django.utils import timezone

from api.models import (
    Account, Team, ProgramPhase, SubEvent, Station,
    StationSession, StationAssignment, ScoreEntry, PhaseRoster,
)
from api.services.auth_service import generate_session


class StationSessionScoreApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin", email="admin@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.collab = Account.objects.create(
            username="coop1", email="coop1@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        self.other_collab = Account.objects.create(
            username="coop2", email="coop2@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=1, is_current=True,
        )
        self.event = SubEvent.objects.create(
            phase=self.phase, name="Station Run",
            type=SubEvent.TYPE_STATION_RUN, uses_stations=True, order=1,
        )
        self.station = Station.objects.create(
            sub_event=self.event, code="VL01", name="Tram 1", order=1,
        )
        self.team = Team.objects.create(
            code="T0001", name="Team A",
            approval_status=Team.APPROVAL_APPROVED, qr_token="tok1",
        )
        PhaseRoster.objects.create(phase=self.phase, team=self.team, origin=PhaseRoster.ORIGIN_APPROVED)
        self.session = StationSession.objects.create(
            phase=self.phase, sub_event=self.event, station=self.station, team=self.team,
            status=StationSession.STATUS_CLOSED, entered_at=timezone.now(),
            exited_at=timezone.now(), score=0,
        )
        StationAssignment.objects.create(collab=self.collab, station=self.station, active=True)

    def _patch(self, account, score):
        token = generate_session(account)
        return self.client.patch(
            f"/api/station-sessions/{self.session.id}/score",
            data=json.dumps({"score": score}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def test_assigned_collab_sets_score_and_creates_entry(self):
        resp = self._patch(self.collab, 15)
        self.assertEqual(resp.status_code, 200)
        self.session.refresh_from_db()
        self.assertEqual(self.session.score, 15)
        entries = ScoreEntry.objects.filter(station_session=self.session, kind=ScoreEntry.KIND_STATION)
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().points, 15)

    def test_reupdate_does_not_duplicate_entry(self):
        self._patch(self.collab, 15)
        resp = self._patch(self.collab, 20)
        self.assertEqual(resp.status_code, 200)
        entries = ScoreEntry.objects.filter(station_session=self.session, kind=ScoreEntry.KIND_STATION)
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().points, 20)

    def test_unassigned_collab_forbidden(self):
        resp = self._patch(self.other_collab, 10)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "not_assigned_to_station")

    def test_admin_can_set_score(self):
        resp = self._patch(self.admin, 8)
        self.assertEqual(resp.status_code, 200)
        self.session.refresh_from_db()
        self.assertEqual(self.session.score, 8)
