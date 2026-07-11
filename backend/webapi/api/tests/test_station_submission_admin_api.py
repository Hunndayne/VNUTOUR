import json

from django.test import TestCase
from django.utils import timezone

from api.models import (
    Account, Team, ProgramPhase, SubEvent, Station,
    StationAssignment, StationSession, StationSubmission, ScoreEntry,
)
from api.services.auth_service import generate_session


class StationSubmissionAdminApiTests(TestCase):
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
        self.submission = StationSubmission.objects.create(
            team=self.team, station=self.station,
            status=StationSubmission.STATUS_SUBMITTED,
            response_payload={
                "form": [{"id": "f1", "label": "Ten doi", "value": "Team A"}],
                "quiz": [{"id": "q1", "question": "1+1?", "selectedOption": 1}],
            },
            attachment_payload={"files": []},
            submitted_at=timezone.now(),
        )

    def _get(self, account):
        token = generate_session(account)
        return self.client.get(
            f"/api/stations/{self.station.id}/submissions",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def _patch(self, account, submission_id, body):
        token = generate_session(account)
        return self.client.patch(
            f"/api/submissions/{submission_id}/grade",
            data=json.dumps(body),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def test_admin_can_list_submissions(self):
        resp = self._get(self.admin)
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertEqual(payload["station_id"], self.station.id)
        self.assertEqual(len(payload["submissions"]), 1)
        item = payload["submissions"][0]
        self.assertEqual(item["team_code"], "T0001")
        self.assertEqual(item["status"], StationSubmission.STATUS_SUBMITTED)
        self.assertIsNone(item["is_correct"])

    def test_unassigned_collab_forbidden(self):
        resp = self._get(self.other_collab)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "not_assigned_to_station")

    def test_assigned_collab_can_list_submissions(self):
        StationAssignment.objects.create(collab=self.collab, station=self.station, active=True)
        resp = self._get(self.collab)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["submissions"]), 1)

    def test_admin_can_grade_submission(self):
        resp = self._patch(self.admin, self.submission.id, {"is_correct": True})
        self.assertEqual(resp.status_code, 200)
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, StationSubmission.STATUS_GRADED)
        self.assertTrue(self.submission.is_correct)
        self.assertEqual(self.submission.graded_by_id, self.admin.id)
        self.assertIsNotNone(self.submission.graded_at)

    def test_grade_submission_not_found(self):
        resp = self._patch(self.admin, 999999, {"is_correct": True})
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "submission_not_found")

    def test_grade_with_score_creates_score_entry(self):
        resp = self._patch(self.admin, self.submission.id, {"is_correct": True, "score": 25})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["score"], 25)

        self.submission.refresh_from_db()
        self.assertEqual(self.submission.score, 25)
        entry = ScoreEntry.objects.get(submission=self.submission)
        self.assertEqual(entry.points, 25)
        self.assertEqual(entry.kind, ScoreEntry.KIND_STATION)
        self.assertEqual(entry.team_id, self.team.id)
        self.assertEqual(entry.phase_id, self.phase.id)

    def test_regrade_score_updates_entry_without_duplicate(self):
        self._patch(self.admin, self.submission.id, {"score": 10})
        resp = self._patch(self.admin, self.submission.id, {"score": 30})

        self.assertEqual(resp.status_code, 200)
        entries = ScoreEntry.objects.filter(submission=self.submission)
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().points, 30)

    def test_grade_score_reuses_session_score_entry(self):
        session = StationSession.objects.create(
            phase=self.phase, sub_event=self.event,
            station=self.station, team=self.team,
            entered_at=timezone.now(),
        )
        self.submission.station_session = session
        self.submission.save()
        existing = ScoreEntry.objects.create(
            phase=self.phase, sub_event=self.event,
            station_session=session, team=self.team,
            kind=ScoreEntry.KIND_STATION, points=5,
        )

        resp = self._patch(self.admin, self.submission.id, {"score": 40})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(ScoreEntry.objects.filter(team=self.team).count(), 1)
        existing.refresh_from_db()
        self.assertEqual(existing.points, 40)
        self.assertEqual(existing.submission_id, self.submission.id)
        session.refresh_from_db()
        self.assertEqual(session.score, 40)

    def test_grade_invalid_score_rejected(self):
        resp = self._patch(self.admin, self.submission.id, {"score": "abc"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"], "invalid_score")

    def test_grade_score_blocked_when_results_locked(self):
        self.phase.is_current = False
        self.phase.save()
        ProgramPhase.objects.create(
            key="ended", label="Ended", order=99, is_current=True,
        )

        resp = self._patch(self.admin, self.submission.id, {"score": 15})

        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "results_locked")
