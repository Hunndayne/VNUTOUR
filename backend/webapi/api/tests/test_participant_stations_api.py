"""`GET /api/my-team/stations` — the station map a team sees during a running event.

The endpoint exists because `/api/me/experience` only ever listed free-play
stations that had a form, which made every `staff_scan` station invisible to the
participants who have to walk up to it. These tests pin that down.
"""

from datetime import timedelta

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from api.models import (
    Account, Participant, PhaseRoster, ProgramPhase, Station, StationSession,
    StationSubmission, SubEvent, SystemSetting, Team, TeamMembership,
)
from api.services.auth_service import generate_session


QUIZ_CONFIG = {
    "items": [
        {"id": "q1", "type": "quiz", "question": "2+2?",
         "options": ["3", "4"], "correctOption": 1},
    ],
}


class StationsApiTestBase(TestCase):
    def setUp(self):
        self.account = Account.objects.create(
            username="captain",
            email="captain@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="SV001",
        )
        self.participant = Participant.objects.create(
            account=self.account,
            mssv="SV001",
            full_name="Captain",
            email="captain@example.com",
        )
        self.team = Team.objects.create(
            code="T0001",
            name="Team A",
            approval_status=Team.APPROVAL_APPROVED,
            qr_token="token",
        )
        TeamMembership.objects.create(
            team=self.team, participant=self.participant, is_captain=True,
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=2, is_current=True,
        )
        PhaseRoster.objects.create(
            phase=self.phase, team=self.team, origin=PhaseRoster.ORIGIN_APPROVED,
        )
        self.event = SubEvent.objects.create(
            phase=self.phase,
            name="Vong loai",
            type=SubEvent.TYPE_STATION_RUN,
            uses_stations=True,
        )
        SystemSetting.objects.update_or_create(
            key="current_sub_event_id", defaults={"value": str(self.event.id)},
        )

        # A staffed station with no form at all: the case the endpoint was added for.
        self.scan_station = Station.objects.create(
            sub_event=self.event,
            code="S01",
            name="Tram the luc",
            location="San A",
            order=1,
            checkin_policy=Station.POLICY_STAFF_SCAN,
            capacity_mode=Station.CAPACITY_LIMITED,
            max_concurrent_teams=2,
        )
        # A free-play station with a quiz form.
        self.form_station = Station.objects.create(
            sub_event=self.event,
            code="S02",
            name="Tram do vui",
            order=2,
            checkin_policy=Station.POLICY_FREE_PLAY,
            submission_config=QUIZ_CONFIG,
        )
        self.token = generate_session(self.account)

    def _get(self, token=None, expect=200):
        response = self.client.get(
            "/api/my-team/stations",
            HTTP_AUTHORIZATION=f"Bearer {token or self.token}",
        )
        self.assertEqual(response.status_code, expect)
        return response.json()

    def _stations_by_code(self, payload=None):
        payload = payload if payload is not None else self._get()
        return {item["station_code"]: item for item in payload["stations"]}

    def _other_team(self, code="T0002"):
        team = Team.objects.create(
            code=code,
            name=f"Team {code}",
            approval_status=Team.APPROVAL_APPROVED,
            qr_token=f"token-{code}",
        )
        PhaseRoster.objects.create(
            phase=self.phase, team=team, origin=PhaseRoster.ORIGIN_APPROVED,
        )
        return team

    def _session(self, station, team=None, status=StationSession.STATUS_ACTIVE,
                 entered_at=None, exited_at=None):
        return StationSession.objects.create(
            phase=self.phase,
            sub_event=self.event,
            station=station,
            team=team or self.team,
            status=status,
            entered_at=entered_at or timezone.now(),
            exited_at=exited_at,
        )


class StationVisibilityTests(StationsApiTestBase):
    def test_a_staff_scan_station_is_listed(self):
        """The gap this endpoint closes: /api/me/experience never showed these."""
        stations = self._stations_by_code()

        self.assertIn("S01", stations)
        self.assertEqual(stations["S01"]["checkin_policy"], Station.POLICY_STAFF_SCAN)

    def test_a_station_without_a_form_is_listed_with_has_form_false(self):
        stations = self._stations_by_code()

        self.assertFalse(stations["S01"]["has_form"])
        self.assertTrue(stations["S02"]["has_form"])

    def test_a_free_play_station_drawing_from_the_shared_bank_has_form_true(self):
        """Regression: a station whose quiz comes entirely from the shared bank
        (no inline items) must still report has_form, or the participant sees
        "already completed" instead of the quiz."""
        from api.models import QuestionBankItem

        QuestionBankItem.objects.create(
            sub_event=self.event, question="Thu do VN?",
            options=["Ha Noi", "TP HCM"], correct_option=0, order=0,
        )
        Station.objects.create(
            sub_event=self.event,
            code="S03",
            name="Tram ngan hang",
            order=3,
            checkin_policy=Station.POLICY_FREE_PLAY,
            submission_config={"items": [], "bank": {"useAll": True}},
        )

        stations = self._stations_by_code()
        self.assertTrue(stations["S03"]["has_form"])

    def test_use_all_with_an_empty_bank_reports_has_form_false(self):
        """useAll on a sub-event with no active bank questions resolves to no
        quiz, so the station has nothing to show."""
        Station.objects.create(
            sub_event=self.event,
            code="S04",
            name="Tram rong",
            order=4,
            checkin_policy=Station.POLICY_FREE_PLAY,
            submission_config={"items": [], "bank": {"useAll": True}},
        )

        stations = self._stations_by_code()
        self.assertFalse(stations["S04"]["has_form"])

    def test_an_inactive_station_is_hidden(self):
        Station.objects.create(
            sub_event=self.event, code="S99", name="Tram tat", order=3, active=False,
        )

        self.assertNotIn("S99", self._stations_by_code())

    def test_a_station_from_another_event_is_hidden(self):
        other_event = SubEvent.objects.create(
            phase=self.phase, name="Vong khac", type=SubEvent.TYPE_STATION_RUN, order=2,
        )
        Station.objects.create(
            sub_event=other_event, code="X01", name="Tram su kien khac",
        )

        self.assertNotIn("X01", self._stations_by_code())

    def test_stations_come_back_in_configured_order(self):
        Station.objects.create(
            sub_event=self.event, code="S00", name="Tram dau", order=0,
        )

        payload = self._get()

        self.assertEqual(
            [item["station_code"] for item in payload["stations"]],
            ["S00", "S01", "S02"],
        )

    def test_envelope_names_the_running_phase_and_event(self):
        payload = self._get()

        self.assertEqual(payload["current_phase"], "qualifying")
        self.assertEqual(payload["current_sub_event_id"], self.event.id)

    def test_no_running_event_returns_an_empty_list_not_an_error(self):
        SystemSetting.objects.filter(key="current_sub_event_id").delete()

        payload = self._get()

        self.assertEqual(payload["stations"], [])
        self.assertIsNone(payload["current_sub_event_id"])
        self.assertEqual(payload["current_phase"], "qualifying")

    def test_a_team_outside_the_current_phase_roster_sees_nothing(self):
        """The phase has a roster, so only the teams on it may see its stations."""
        final = ProgramPhase.objects.create(key="final", label="Final", order=3)
        # Keep a roster row for our team elsewhere, otherwise the approved-team
        # backfill would simply put it straight back into qualifying.
        PhaseRoster.objects.filter(team=self.team, phase=self.phase).delete()
        PhaseRoster.objects.create(
            phase=final, team=self.team, origin=PhaseRoster.ORIGIN_MANUAL,
        )
        self._other_team()  # keeps `qualifying` a phase that has a roster

        payload = self._get()

        self.assertEqual(payload["stations"], [])
        self.assertEqual(payload["current_sub_event_id"], self.event.id)

    def test_a_phase_without_any_roster_admits_the_current_phase(self):
        PhaseRoster.objects.all().delete()
        self.team.approval_status = Team.APPROVAL_DRAFT  # no backfill for this team
        self.team.save(update_fields=["approval_status"])

        self.assertEqual(len(self._get()["stations"]), 2)


class StationPayloadTests(StationsApiTestBase):
    def test_station_identity_fields(self):
        station = self._stations_by_code()["S01"]

        self.assertEqual(station["station_id"], self.scan_station.id)
        self.assertEqual(station["station_name"], "Tram the luc")
        self.assertEqual(station["station_location"], "San A")

    def test_checkout_after_submit_defaults_to_true_and_follows_the_config(self):
        self.form_station.submission_config = {
            **QUIZ_CONFIG, "flow": {"checkoutAfterSubmit": False},
        }
        self.form_station.save(update_fields=["submission_config"])

        stations = self._stations_by_code()

        self.assertFalse(stations["S02"]["checkout_after_submit"])
        self.assertTrue(stations["S01"]["checkout_after_submit"])

    def test_capacity_counts_active_sessions_of_every_team(self):
        self._session(self.scan_station, team=self._other_team("T0002"))
        self._session(self.scan_station, team=self._other_team("T0003"),
                      status=StationSession.STATUS_CLOSED, exited_at=timezone.now())

        capacity = self._stations_by_code()["S01"]["capacity"]

        self.assertEqual(capacity["max_concurrent_teams"], 2)
        self.assertEqual(capacity["current_teams"], 1)

    def test_capacity_reports_no_limit_as_none(self):
        capacity = self._stations_by_code()["S02"]["capacity"]

        self.assertIsNone(capacity["max_concurrent_teams"])
        self.assertEqual(capacity["current_teams"], 0)


class MySessionTests(StationsApiTestBase):
    def test_my_session_is_null_before_the_team_ever_enters(self):
        stations = self._stations_by_code()

        self.assertIsNone(stations["S01"]["my_session"])
        self.assertIsNone(stations["S02"]["my_session"])

    def test_my_session_reports_an_open_visit(self):
        entered = timezone.now()
        self._session(self.scan_station, entered_at=entered)

        session = self._stations_by_code()["S01"]["my_session"]

        self.assertEqual(session["status"], StationSession.STATUS_ACTIVE)
        self.assertEqual(session["entered_at"], entered.isoformat())
        self.assertIsNone(session["exited_at"])

    def test_my_session_reports_the_visit_once_it_closes(self):
        record = self._session(self.scan_station)
        record.status = StationSession.STATUS_CLOSED
        record.exited_at = timezone.now()
        record.save(update_fields=["status", "exited_at"])

        session = self._stations_by_code()["S01"]["my_session"]

        self.assertEqual(session["status"], StationSession.STATUS_CLOSED)
        self.assertEqual(session["exited_at"], record.exited_at.isoformat())

    def test_the_most_recent_visit_wins(self):
        old = timezone.now() - timedelta(hours=2)
        self._session(
            self.scan_station, status=StationSession.STATUS_CLOSED,
            entered_at=old, exited_at=old,
        )
        latest = self._session(self.scan_station, entered_at=timezone.now())

        session = self._stations_by_code()["S01"]["my_session"]

        self.assertEqual(session["status"], StationSession.STATUS_ACTIVE)
        self.assertEqual(session["entered_at"], latest.entered_at.isoformat())

    def test_another_teams_session_is_not_reported_as_mine(self):
        self._session(self.scan_station, team=self._other_team())

        self.assertIsNone(self._stations_by_code()["S01"]["my_session"])


class MySubmissionTests(StationsApiTestBase):
    def test_my_submission_is_null_until_the_team_submits(self):
        self.assertIsNone(self._stations_by_code()["S02"]["my_submission"])

    def test_my_submission_carries_status_and_timestamp(self):
        submitted_at = timezone.now()
        StationSubmission.objects.create(
            team=self.team,
            station=self.form_station,
            status=StationSubmission.STATUS_SUBMITTED,
            submitted_at=submitted_at,
        )

        submission = self._stations_by_code()["S02"]["my_submission"]

        self.assertEqual(submission["status"], StationSubmission.STATUS_SUBMITTED)
        self.assertEqual(submission["submitted_at"], submitted_at.isoformat())

    def test_a_draft_submission_reports_a_null_timestamp(self):
        StationSubmission.objects.create(
            team=self.team, station=self.form_station,
            status=StationSubmission.STATUS_DRAFT,
        )

        submission = self._stations_by_code()["S02"]["my_submission"]

        self.assertEqual(submission["status"], StationSubmission.STATUS_DRAFT)
        self.assertIsNone(submission["submitted_at"])

    def test_another_teams_submission_is_not_reported_as_mine(self):
        StationSubmission.objects.create(
            team=self._other_team(), station=self.form_station,
            status=StationSubmission.STATUS_SUBMITTED, submitted_at=timezone.now(),
        )

        self.assertIsNone(self._stations_by_code()["S02"]["my_submission"])


class StationsAccessTests(StationsApiTestBase):
    def test_a_non_participant_is_forbidden(self):
        admin = Account.objects.create(
            username="admin", email="admin@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )

        response = self.client.get(
            "/api/my-team/stations",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(admin)}",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "forbidden")

    def test_a_participant_without_a_team_gets_no_team(self):
        loner = Account.objects.create(
            username="loner", email="loner@example.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="SV999",
        )
        Participant.objects.create(
            account=loner, mssv="SV999", full_name="Loner", email="loner@example.com",
        )

        response = self.client.get(
            "/api/my-team/stations",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(loner)}",
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"], "no_team")

    def test_an_anonymous_request_is_rejected(self):
        self.assertEqual(self.client.get("/api/my-team/stations").status_code, 401)

    def test_the_trailing_slash_route_answers_too(self):
        response = self.client.get(
            "/api/my-team/stations/",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)


class StationsQueryCountTests(StationsApiTestBase):
    def test_the_query_count_does_not_grow_with_the_number_of_stations(self):
        """Session/submission/occupancy lookups are grouped, never per station."""
        with CaptureQueriesContext(connection) as baseline:
            self._get()

        for index in range(10):
            station = Station.objects.create(
                sub_event=self.event, code=f"B{index}", name=f"Bulk {index}",
                order=10 + index, submission_config=QUIZ_CONFIG,
            )
            StationSubmission.objects.create(
                team=self.team, station=station,
                status=StationSubmission.STATUS_SUBMITTED, submitted_at=timezone.now(),
            )
            self._session(
                station, status=StationSession.STATUS_CLOSED, exited_at=timezone.now(),
            )

        with CaptureQueriesContext(connection) as grown:
            payload = self._get()

        self.assertEqual(len(payload["stations"]), 12)
        self.assertEqual(len(grown), len(baseline))
