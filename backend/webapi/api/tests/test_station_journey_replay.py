"""Station journey & the qualifying-round replay rule.

Three things changed together here (see plan/qualifying-journey-and-replay.md):
a station now declares how it scores (`scoring_mode`), a session records
whether it cleared the station (`outcome`), and an event can switch on a rule
that only lets a team re-enter a station once it has visited every other
active station — and never again once it has passed. The riskiest part is the
score aggregation: replaying a station used to let `ScoreEntry` rows stack
(three plays of 2/5/3 summed to 10); now exactly one entry per (team,
station) survives, holding the best play under the station's mode.
"""

import json

from django.test import TestCase
from django.utils import timezone

from api.models import (
    Account, Participant, PhaseRoster, ProgramPhase, ScoreEntry, Station,
    StationSession, SubEvent, SystemSetting, Team, TeamMembership,
)
from api.services.auth_service import generate_session


class StationJourneyTestBase(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin", email="admin@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.collab = Account.objects.create(
            username="coop1", email="coop1@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=1, is_current=True,
        )
        self.event = SubEvent.objects.create(
            phase=self.phase, name="Station Run",
            type=SubEvent.TYPE_STATION_RUN, uses_stations=True, order=1,
        )
        self.team = Team.objects.create(
            code="T0001", name="Team A",
            approval_status=Team.APPROVAL_APPROVED, qr_token="tok1",
        )
        PhaseRoster.objects.create(
            phase=self.phase, team=self.team, origin=PhaseRoster.ORIGIN_APPROVED,
        )

    def _enter(self, station, team=None, account=None):
        token = generate_session(account or self.collab)
        return self.client.post(
            "/api/station-sessions/enter",
            data=json.dumps({
                "code": (team or self.team).code, "stationId": station.id,
                "phaseKey": self.phase.key, "eventId": self.event.id,
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def _exit(self, station, team=None, score=None, account=None):
        token = generate_session(account or self.collab)
        body = {"code": (team or self.team).code, "stationId": station.id}
        if score is not None:
            body["score"] = score
        return self.client.post(
            "/api/station-sessions/exit",
            data=json.dumps(body),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def _play(self, station, score, team=None, account=None):
        """Enter then exit a station in one go; returns the exit response."""
        enter_resp = self._enter(station, team=team, account=account)
        self.assertEqual(enter_resp.status_code, 201, enter_resp.json())
        return self._exit(station, team=team, score=score, account=account)

    def _set_score(self, session_id, body, account=None):
        # Defaults to admin: the score endpoint also gates collabs by station
        # assignment, which is exercised elsewhere (test_station_session_score_api)
        # and is a distraction from the aggregation/outcome rules under test here.
        token = generate_session(account or self.admin)
        return self.client.patch(
            f"/api/station-sessions/{session_id}/score",
            data=json.dumps(body),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def _station_score_entries(self, station, team=None):
        return ScoreEntry.objects.filter(
            kind=ScoreEntry.KIND_STATION,
            station_session__station=station,
            team=team or self.team,
        )


class ScoreAggregationTests(StationJourneyTestBase):
    """The riskiest part: one ScoreEntry per (team, station), best play wins."""

    def test_score_only_takes_the_best_play_not_the_sum(self):
        station = Station.objects.create(
            sub_event=self.event, code="S01", name="Tram do suc", order=1,
            scoring_mode=Station.SCORING_SCORE_ONLY,
        )
        for score in (2, 5, 3):
            resp = self._play(station, score)
            self.assertEqual(resp.status_code, 200)

        entries = self._station_score_entries(station)
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().points, 5)

    def test_threshold_only_counts_passed_plays(self):
        station = Station.objects.create(
            sub_event=self.event, code="S02", name="Tram nguong", order=2,
            scoring_mode=Station.SCORING_THRESHOLD, pass_threshold=5,
        )
        for score in (3, 6, 4):  # fail, pass, fail
            resp = self._play(station, score)
            self.assertEqual(resp.status_code, 200)

        entries = self._station_score_entries(station)
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().points, 6)

    def test_threshold_scores_zero_when_never_passed(self):
        station = Station.objects.create(
            sub_event=self.event, code="S02b", name="Tram nguong 2", order=2,
            scoring_mode=Station.SCORING_THRESHOLD, pass_threshold=5,
        )
        for score in (1, 2, 3):
            self._play(station, score)

        self.assertEqual(self._station_score_entries(station).count(), 0)

    def test_pass_fail_awards_flat_points_once_passed(self):
        station = Station.objects.create(
            sub_event=self.event, code="S03", name="Tram dat khong", order=3,
            scoring_mode=Station.SCORING_PASS_FAIL, pass_points=10,
        )
        enter = self._enter(station)
        session_id = enter.json()["id"]
        self._exit(station)  # no score field — pass_fail leaves outcome pending

        resp = self._set_score(session_id, {"outcome": "passed"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["outcome"], "passed")

        entries = self._station_score_entries(station)
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().points, 10)

    def test_pass_fail_scores_zero_when_never_passed(self):
        station = Station.objects.create(
            sub_event=self.event, code="S04", name="Tram dat khong 2", order=4,
            scoring_mode=Station.SCORING_PASS_FAIL, pass_points=10,
        )
        enter = self._enter(station)
        session_id = enter.json()["id"]
        self._exit(station)

        resp = self._set_score(session_id, {"outcome": "failed"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._station_score_entries(station).count(), 0)

    def test_a_later_play_replaces_an_earlier_higher_score_entry_in_place(self):
        """No duplicate rows are left behind as the anchor session changes."""
        station = Station.objects.create(
            sub_event=self.event, code="S05", name="Tram do suc 2", order=5,
        )
        self._play(station, 9)
        self._play(station, 2)  # worse play — the entry must still read 9

        entries = self._station_score_entries(station)
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().points, 9)


class OutcomeDerivationTests(StationJourneyTestBase):
    """`PATCH /station-sessions/<id>/score` infers `outcome` per scoring_mode."""

    def test_threshold_endpoint_infers_pass_and_fail(self):
        station = Station.objects.create(
            sub_event=self.event, code="T1", name="Tram nguong", order=1,
            scoring_mode=Station.SCORING_THRESHOLD, pass_threshold=10,
        )
        enter = self._enter(station)
        session_id = enter.json()["id"]
        self._exit(station)

        resp = self._set_score(session_id, {"score": 5})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["outcome"], "failed")

        resp = self._set_score(session_id, {"score": 12})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["outcome"], "passed")

    def test_score_only_endpoint_always_passes(self):
        station = Station.objects.create(
            sub_event=self.event, code="T2", name="Tram diem", order=2,
        )
        enter = self._enter(station)
        session_id = enter.json()["id"]
        self._exit(station)

        resp = self._set_score(session_id, {"score": 0})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["outcome"], "passed")

    def test_pass_fail_endpoint_requires_outcome_not_score(self):
        station = Station.objects.create(
            sub_event=self.event, code="T3", name="Tram dat", order=3,
            scoring_mode=Station.SCORING_PASS_FAIL, pass_points=7,
        )
        enter = self._enter(station)
        session_id = enter.json()["id"]
        self._exit(station)

        missing = self._set_score(session_id, {"score": 5})
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()["error"], "missing_outcome")

        resp = self._set_score(session_id, {"outcome": "passed"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["score"], 7)
        self.assertEqual(resp.json()["outcome"], "passed")

    def test_pass_fail_rejects_a_bogus_outcome(self):
        station = Station.objects.create(
            sub_event=self.event, code="T4", name="Tram dat 2", order=4,
            scoring_mode=Station.SCORING_PASS_FAIL, pass_points=7,
        )
        enter = self._enter(station)
        session_id = enter.json()["id"]
        self._exit(station)

        resp = self._set_score(session_id, {"outcome": "maybe"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"], "missing_outcome")


class ReplayRuleTests(StationJourneyTestBase):
    """`enter_station` gates a re-entry once `sub_event.replay_after_all` is on."""

    def setUp(self):
        super().setUp()
        self.event.replay_after_all = True
        self.event.save(update_fields=["replay_after_all"])
        self.station_a = Station.objects.create(
            sub_event=self.event, code="A", name="Tram A", order=1,
            scoring_mode=Station.SCORING_THRESHOLD, pass_threshold=100,
        )
        self.station_b = Station.objects.create(
            sub_event=self.event, code="B", name="Tram B", order=2,
        )

    def test_first_visit_to_a_station_is_never_blocked(self):
        resp = self._play(self.station_a, 10)  # fails (10 < 100), but that's fine
        self.assertEqual(resp.status_code, 200)

    def test_replay_locked_incomplete_until_every_station_is_visited(self):
        self._play(self.station_a, 10)  # closes A; B still untouched

        resp = self._enter(self.station_a)

        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "replay_locked_incomplete")

    def test_replay_allowed_once_every_station_is_visited_but_not_yet_passed(self):
        self._play(self.station_a, 10)  # visits + fails A
        self._play(self.station_b, 5)   # visits B (score_only always "passes")

        resp = self._enter(self.station_a)

        self.assertEqual(resp.status_code, 201)

    def test_replay_locked_once_passed(self):
        self._play(self.station_a, 10)   # fails A
        self._play(self.station_b, 5)    # visits B — loop now complete
        self._play(self.station_a, 200)  # re-enter (allowed) and pass A

        resp = self._enter(self.station_a)

        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "replay_locked_passed")

    def test_switch_off_keeps_unlimited_replay(self):
        self.event.replay_after_all = False
        self.event.save(update_fields=["replay_after_all"])

        self._play(self.station_a, 10)  # B never visited
        resp = self._enter(self.station_a)  # would be "incomplete" if the switch were on

        self.assertEqual(resp.status_code, 201)

    def test_station_scan_view_maps_the_same_two_error_codes(self):
        """The QR-driven scan endpoint shares `enter_station`, so it must too."""
        from api.models import StationAssignment
        from api.services.checkin_qr_service import set_checkin_qr

        set_checkin_qr(True)
        StationAssignment.objects.create(collab=self.collab, station=self.station_a, active=True)
        self._play(self.station_a, 10)

        self.team.refresh_from_db()
        code = f"t:{self.team.qr_token}|s:{self.station_a.id}|d:in"
        token = generate_session(self.collab)
        resp = self.client.post(
            "/api/station-scan",
            data=json.dumps({"code": code}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "replay_locked_incomplete")


class MyTeamStationsJourneyTests(StationJourneyTestBase):
    """`GET /api/my-team/stations` — the journey fields a team sees."""

    def setUp(self):
        super().setUp()
        self.account = Account.objects.create(
            username="captain", email="captain@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV001",
        )
        self.participant = Participant.objects.create(
            account=self.account, mssv="SV001", full_name="Captain",
            email="captain@example.com",
        )
        TeamMembership.objects.create(
            team=self.team, participant=self.participant, is_captain=True,
        )
        SystemSetting.objects.update_or_create(
            key="current_sub_event_id", defaults={"value": str(self.event.id)},
        )
        self.token = generate_session(self.account)

        self.station_score_only = Station.objects.create(
            sub_event=self.event, code="J1", name="Tram diem", order=1,
        )
        self.station_threshold = Station.objects.create(
            sub_event=self.event, code="J2", name="Tram nguong", order=2,
            scoring_mode=Station.SCORING_THRESHOLD, pass_threshold=10,
        )

    def _get(self):
        resp = self.client.get(
            "/api/my-team/stations",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(resp.status_code, 200)
        return resp.json()

    def _by_code(self, payload=None):
        payload = payload if payload is not None else self._get()
        return {item["station_code"]: item for item in payload["stations"]}

    def test_a_station_never_visited_reports_zeroed_journey_fields(self):
        item = self._by_code()["J1"]

        self.assertEqual(item["visit_count"], 0)
        self.assertEqual(item["best_score"], 0)
        self.assertEqual(item["status"], "not_visited")
        self.assertEqual(item["scoring_mode"], Station.SCORING_SCORE_ONLY)

    def test_visit_count_excludes_cancelled_sessions(self):
        self._play(self.station_score_only, 4)
        StationSession.objects.create(
            phase=self.phase, sub_event=self.event, station=self.station_score_only,
            team=self.team, status=StationSession.STATUS_CANCELLED,
            entered_at=timezone.now(),
        )

        item = self._by_code()["J1"]

        self.assertEqual(item["visit_count"], 1)
        self.assertEqual(item["best_score"], 4)
        self.assertEqual(item["status"], "passed")  # score_only always "passes" on close

    def test_an_active_visit_reports_status_active(self):
        self._enter(self.station_score_only)

        item = self._by_code()["J1"]

        self.assertEqual(item["visit_count"], 1)
        self.assertEqual(item["status"], "active")

    def test_threshold_station_reports_failed_until_it_passes(self):
        self._play(self.station_threshold, 3)  # below the threshold of 10

        item = self._by_code()["J2"]
        self.assertEqual(item["status"], "failed")
        self.assertEqual(item["best_score"], 0)  # never passed => 0, not the raw 3

        self._play(self.station_threshold, 15)

        item = self._by_code()["J2"]
        self.assertEqual(item["status"], "passed")
        self.assertEqual(item["best_score"], 15)

    def test_summary_counts_visited_and_passed_stations(self):
        self._play(self.station_score_only, 4)   # visited + passed
        self._play(self.station_threshold, 3)    # visited, not passed

        payload = self._get()

        self.assertEqual(payload["total_stations"], 2)
        self.assertEqual(payload["visited_count"], 2)
        self.assertEqual(payload["passed_count"], 1)
        self.assertTrue(payload["all_visited"])
        self.assertFalse(payload["replay_enabled"])

    def test_replay_fields_are_absent_when_the_switch_is_off(self):
        item = self._by_code()["J1"]

        self.assertNotIn("replay_locked", item)
        self.assertNotIn("replay_reason", item)

    def test_replay_reason_is_incomplete_before_the_loop_closes(self):
        self.event.replay_after_all = True
        self.event.save(update_fields=["replay_after_all"])
        self._play(self.station_score_only, 4)  # J1 visited+passed; J2 untouched

        payload = self._get()
        self.assertTrue(payload["replay_enabled"])

        j1 = self._by_code(payload)["J1"]
        self.assertTrue(j1["replay_locked"])
        self.assertEqual(j1["replay_reason"], "incomplete")

        j2 = self._by_code(payload)["J2"]
        self.assertFalse(j2["replay_locked"])  # never visited — always open
        self.assertIsNone(j2["replay_reason"])

    def test_replay_reason_switches_to_passed_once_the_loop_closes(self):
        self.event.replay_after_all = True
        self.event.save(update_fields=["replay_after_all"])
        self._play(self.station_score_only, 4)  # J1: visited + passed
        self._play(self.station_threshold, 3)   # J2: visited, failed (3 < 10)

        j1 = self._by_code()["J1"]
        self.assertTrue(j1["replay_locked"])
        self.assertEqual(j1["replay_reason"], "passed")

        j2 = self._by_code()["J2"]
        self.assertFalse(j2["replay_locked"])  # visited, failed, loop closed — retry is open
        self.assertIsNone(j2["replay_reason"])
