"""Offline challenges at a station, and the per-station "show score" switch.

A challenge is scored by a coop (0..maxPoints); the visit's score is the form
part plus every challenge. Participants only ever see "Thử thách N".
"""

import json
from datetime import datetime, timedelta
from unittest.mock import patch

from django.utils import timezone

from api.models import (
    Account, ScoreEntry, Station, StationAssignment, StationSession, StationSubmission, SubEvent, SystemSetting,
)
from api.services.auth_service import generate_session
from api.services.submission_config_service import has_form, normalize_config, public_config
from api.tests.test_participant_forms_api import FormsApiTestBase

SECRET_TITLE = "Nhảy bao bố quanh hồ"
SECRET_NOTE = "Chạm vạch đỏ mới tính"


def _config(with_quiz=True):
    items = []
    if with_quiz:
        items.append({"id": "q1", "type": "quiz", "question": "Capital?",
                      "options": ["Hanoi", "Hue"], "correctOption": 0, "points": 3})
    items += [
        {"id": "c1", "type": "challenge", "title": SECRET_TITLE,
         "description": SECRET_NOTE, "maxPoints": 10},
        {"id": "c2", "type": "challenge", "title": "Kéo co", "maxPoints": 20},
    ]
    if with_quiz:
        items.append({"id": "q2", "type": "text", "label": "Name it", "points": 2})
    return {"items": items}


class ChallengeConfigTests(FormsApiTestBase):
    def test_normalize_keeps_challenges_and_defaults_max_points(self):
        cfg = normalize_config({"items": [
            {"id": "c1", "type": "challenge", "title": " A ", "maxPoints": "x"},
            {"id": "c2", "type": "challenge", "title": "B", "maxPoints": -5},
        ]})
        self.assertEqual([i["type"] for i in cfg["items"]], ["challenge", "challenge"])
        self.assertEqual(cfg["items"][0]["title"], "A")
        self.assertEqual(cfg["items"][0]["maxPoints"], 10)
        self.assertEqual(cfg["items"][1]["maxPoints"], 1)

    def test_public_config_only_carries_anonymous_labels(self):
        public = public_config(_config())
        challenges = [i for i in public["items"] if i["type"] == "challenge"]
        self.assertEqual([c["label"] for c in challenges], ["Thử thách 1", "Thử thách 2"])
        self.assertEqual(set(challenges[0]), {"id", "type", "label", "maxPoints"})
        self.assertNotIn(SECRET_TITLE, json.dumps(public, ensure_ascii=False))
        self.assertNotIn(SECRET_NOTE, json.dumps(public, ensure_ascii=False))

    def test_labels_survive_a_random_draw(self):
        cfg = _config()
        cfg["quiz"] = {"randomCount": 1}
        public = public_config(cfg, item_ids=["q2"])
        self.assertEqual(
            [i["label"] if i["type"] == "challenge" else i["id"] for i in public["items"]],
            ["Thử thách 1", "Thử thách 2", "q2"],
        )

    def test_challenges_alone_are_not_a_form(self):
        self.assertFalse(has_form(_config(with_quiz=False)))
        self.assertTrue(has_form(_config()))


class ChallengeApiTestBase(FormsApiTestBase):
    def setUp(self):
        super().setUp()
        self.event.end_date = timezone.now() + timedelta(hours=2)
        self.event.save(update_fields=["end_date"])
        self.station.submission_config = _config()
        self.station.save()
        self.coop = Account.objects.create(username="coop", email="coop@example.com", role="collab")
        StationAssignment.objects.create(collab=self.coop, station=self.station, active=True)
        self.master = Account.objects.create(username="master", email="m@example.com",
                                             role=Account.ROLE_MASTER_ADMIN)
        SystemSetting.objects.update_or_create(
            key="current_sub_event_id", defaults={"value": str(self.event.id)},
        )

    def request_as(self, method, url, body=None, actor=None):
        return getattr(self.client, method)(
            url, data=json.dumps(body) if body is not None else None,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(actor or self.account)}",
        )

    def checkout(self):
        response = self.request_as(
            "post", "/api/station-scan",
            {"code": f"t:{self.team.qr_token}|s:{self.station.id}|d:out"}, self.coop,
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def grade(self, body):
        return self.request_as("patch", f"/api/station-sessions/{self.session.id}/score", body, self.coop)

    def entry_points(self):
        entry = ScoreEntry.objects.filter(team=self.team, kind=ScoreEntry.KIND_STATION).first()
        return entry.points if entry else 0

    def journey_station(self):
        response = self.request_as("get", "/api/my-team/stations")
        self.assertEqual(response.status_code, 200, response.content)
        return next(s for s in response.json()["stations"] if s["station_id"] == self.station.id)


class ChallengeScoringTests(ChallengeApiTestBase):
    def test_checkout_gives_coop_the_real_challenges(self):
        data = self.checkout()
        self.assertEqual([c["title"] for c in data["challenges"]], [SECRET_TITLE, "Kéo co"])
        self.assertEqual(data["challenges"][0]["maxPoints"], 10)
        self.assertIsNone(data["challenges"][0]["points"])

    def test_total_is_form_plus_challenges_and_updates_are_partial(self):
        self.checkout()
        response = self.grade({"score": 3, "challenges": {"c1": 7, "c2": 15}})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["score"], 25)
        self.assertEqual(response.json()["form_score"], 3)

        response = self.grade({"challenges": {"c2": 20}})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["score"], 30)
        self.assertEqual(response.json()["challenge_scores"], {"c1": 7, "c2": 20})
        self.assertEqual(self.entry_points(), 30)

        response = self.grade({"score": 5})
        self.assertEqual(response.json()["score"], 32)

    def test_out_of_range_or_unknown_challenge_is_rejected(self):
        self.checkout()
        self.grade({"challenges": {"c1": 4}})
        for bad in ({"c1": 11}, {"c1": -1}, {"zz": 1}, {"c1": "abc"}, {"c1": True}, [1]):
            response = self.grade({"challenges": bad})
            self.assertEqual(response.status_code, 400, bad)
            self.assertEqual(response.json()["error"], "invalid_challenge_score")
        self.session.refresh_from_db()
        self.assertEqual(self.session.score, 4)

    def test_threshold_judges_the_total(self):
        self.station.scoring_mode = Station.SCORING_THRESHOLD
        self.station.pass_threshold = 20
        self.station.save()
        self.checkout()
        self.assertEqual(self.grade({"score": 3, "challenges": {"c1": 10}}).json()["outcome"], "failed")
        self.assertEqual(self.grade({"challenges": {"c2": 7}}).json()["outcome"], "passed")

    def test_admin_regrading_the_form_keeps_challenge_points(self):
        submit = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}],
                                                    "form": [{"id": "q2", "value": "x"}]}})
        self.assertEqual(submit.status_code, 201, submit.content)
        self.checkout()
        self.grade({"challenges": {"c1": 8, "c2": 12}})
        admin = Account.objects.create(username="admin", email="a@example.com", role="admin")
        submission = StationSubmission.objects.get(id=submit.json()["id"])
        response = self.request_as("patch", f"/api/submissions/{submission.id}/grade", {"score": 5}, admin)
        self.assertEqual(response.status_code, 200, response.content)
        self.session.refresh_from_db()
        self.assertEqual(self.session.score, 25)
        self.assertEqual(self.session.form_score, 5)
        submission.refresh_from_db()
        self.assertEqual(submission.score, 5)

    def test_auto_score_on_submit_keeps_challenge_points(self):
        self.station.submission_config["quiz"] = {"autoScore": True}
        self.station.save()
        self.grade({"challenges": {"c1": 9}})
        submit = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}],
                                                    "form": [{"id": "q2", "value": "x"}]}})
        self.assertEqual(submit.status_code, 201, submit.content)
        self.session.refresh_from_db()
        self.assertEqual(self.session.form_score, 3)
        self.assertEqual(self.session.score, 12)

    def test_challenge_only_station_is_graded_without_a_submission(self):
        self.station.submission_config = _config(with_quiz=False)
        self.station.save()
        data = self.checkout()
        self.assertIsNone(data["submission"])
        response = self.grade({"challenges": {"c1": 10, "c2": 5}})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["score"], 15)
        self.assertEqual(self.entry_points(), 15)

    def test_missing_both_parts_is_rejected(self):
        self.checkout()
        self.assertEqual(self.grade({}).status_code, 400)

    def test_pre_challenge_score_is_kept_as_the_form_part(self):
        StationSession.objects.filter(id=self.session.id).update(score=6)
        self.checkout()
        self.assertEqual(self.grade({"challenges": {"c1": 4}}).json()["score"], 10)


class ChallengeStationConfigTests(ChallengeApiTestBase):
    def test_pass_fail_station_cannot_have_challenges(self):
        response = self.request_as("patch", f"/api/stations/{self.station.id}",
                                   {"scoring_mode": "pass_fail"}, self.master)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "challenges_not_allowed_pass_fail")

        self.station.submission_config = {"items": []}
        self.station.scoring_mode = Station.SCORING_PASS_FAIL
        self.station.save()
        response = self.request_as("patch", f"/api/stations/{self.station.id}",
                                   {"submission_config": _config()}, self.master)
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_challenges_on_survey(self):
        survey = SubEvent.objects.create(phase=self.phase, name="Survey", type=SubEvent.TYPE_SURVEY)
        response = self.request_as("post", f"/api/sub-events/{survey.id}/stations",
                                   {"code": "S1", "name": "S", "submission_config": _config()}, self.master)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "challenges_not_allowed_survey")

    def test_coop_station_list_has_real_titles_but_config_is_anonymous(self):
        response = self.request_as(
            "get", f"/api/program/phases/{self.phase.key}/sub-events/{self.event.id}/stations", actor=self.coop,
        )
        station = next(s for s in response.json()["stations"] if s["id"] == self.station.id)
        self.assertEqual(station["challenges"][0]["title"], SECRET_TITLE)
        self.assertNotIn(SECRET_TITLE, json.dumps(station["submission_config"], ensure_ascii=False))
        self.assertTrue(station["show_score_to_participants"])

    def test_show_score_switch_is_saved(self):
        response = self.request_as("patch", f"/api/stations/{self.station.id}",
                                   {"show_score_to_participants": False}, self.master)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["show_score_to_participants"])
        self.station.refresh_from_db()
        self.assertFalse(self.station.show_score_to_participants)
        bad = self.request_as("patch", f"/api/stations/{self.station.id}",
                              {"show_score_to_participants": "no"}, self.master)
        self.assertEqual(bad.status_code, 400)


class ChallengeParticipantTests(ChallengeApiTestBase):
    def setUp(self):
        super().setUp()
        # Most tests here check what a team sees once scores are allowed out.
        self.set_site_scores(True)

    def set_site_scores(self, visible):
        response = self.request_as("put", "/api/admin/site-config",
                                   {"participant_scores_visible": visible}, self.master)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["participant_scores_visible"], visible)

    def test_site_switch_is_off_by_default_and_hides_every_score(self):
        SystemSetting.objects.filter(key="participant_scores_visible").delete()
        self.graded_visit()
        station = self.journey_station()
        self.assertIsNone(station["best_score"])
        self.assertFalse(station["show_score"])
        self.assertEqual([c["points"] for c in station["challenges"]], [None, None])
        state = self.request_as("get", f"/api/my-team/station-state?station_id={self.station.id}").json()
        self.assertIsNone(state["submission"]["score"])
        self.assertIsNone(state["submission"]["quiz_result"])
        attempt = self.request_as("get", "/api/my-team/question-history").json()["attempts"][0]
        self.assertIsNone(attempt["score"])
        # Turning the site switch on is what lets the station's own switch count.
        self.set_site_scores(True)
        self.assertEqual(self.journey_station()["best_score"], 25)

    def graded_visit(self):
        submit = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}],
                                                    "form": [{"id": "q2", "value": "x"}]}})
        self.assertEqual(submit.status_code, 201, submit.content)
        self.checkout()
        self.assertEqual(self.grade({"score": 3, "challenges": {"c1": 7, "c2": 15}}).status_code, 200)

    def participant_payloads(self):
        with patch('api.services.submission_review_service.timezone.now',
                   return_value=self.event.end_date + timedelta(minutes=1)):
            return {
                "forms": self.request_as("get", "/api/my-team/forms").content.decode(),
                "stations": self.request_as("get", "/api/my-team/stations").content.decode(),
                "state": self.request_as(
                    "get", f"/api/my-team/station-state?station_id={self.station.id}").content.decode(),
                "history": self.request_as("get", "/api/my-team/question-history").content.decode(),
                "experience": self.request_as("get", "/api/me/experience").content.decode(),
            }

    def test_no_participant_payload_names_a_challenge(self):
        self.graded_visit()
        for name, body in self.participant_payloads().items():
            text = json.loads(body)
            dumped = json.dumps(text, ensure_ascii=False)
            self.assertNotIn(SECRET_TITLE, dumped, name)
            self.assertNotIn(SECRET_NOTE, dumped, name)

    def test_journey_shows_anonymous_challenge_points(self):
        self.graded_visit()
        station = self.journey_station()
        self.assertEqual(station["best_score"], 25)
        self.assertTrue(station["show_score"])
        self.assertEqual(station["challenges"], [
            {"label": "Thử thách 1", "max_points": 10, "points": 7, "graded": True},
            {"label": "Thử thách 2", "max_points": 20, "points": 15, "graded": True},
        ])

    def test_hidden_score_leaves_no_numbers_for_participants(self):
        self.graded_visit()
        self.station.show_score_to_participants = False
        self.station.save()

        station = self.journey_station()
        self.assertIsNone(station["best_score"])
        self.assertFalse(station["show_score"])
        self.assertEqual([c["points"] for c in station["challenges"]], [None, None])
        self.assertEqual([c["max_points"] for c in station["challenges"]], [None, None])
        self.assertEqual([c["graded"] for c in station["challenges"]], [True, True])

        state = self.request_as("get", f"/api/my-team/station-state?station_id={self.station.id}").json()
        self.assertIsNone(state["submission"]["score"])
        self.assertIsNone(state["submission"]["quiz_result"])

        attempt = self.request_as("get", "/api/my-team/question-history").json()["attempts"][0]
        self.assertIsNone(attempt["score"])
        self.assertIsNone(attempt["quiz_result"])

        # Staff and the leaderboard still count it.
        self.assertEqual(self.entry_points(), 25)
        coop_view = self.request_as("get", f"/api/stations/{self.station.id}/submissions", actor=self.coop).json()
        self.assertEqual(coop_view["submissions"][0]["score"], 3)
        self.assertEqual([c["points"] for c in coop_view["submissions"][0]["challenges"]], [7, 15])


class ChallengeSkipPenaltyTests(ChallengeApiTestBase):
    def setUp(self):
        super().setUp()
        config = _config()
        config["items"][1]["durationMinutes"] = 20  # c1
        self.station.submission_config = config
        self.station.save()

    def skip(self, challenge_id, undo=False, actor=None):
        return self.request_as(
            "post", f"/api/station-sessions/{self.session.id}/challenge-skip",
            {"challenge_id": challenge_id, "undo": undo}, actor or self.coop,
        )

    def test_skip_scores_zero_and_holds_checkout_for_duration_plus_15(self):
        before = timezone.now()
        response = self.skip("c1")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["challenge_scores"], {"c1": 0})
        self.assertIn("c1", data["challenge_skips"])
        until = datetime.fromisoformat(data["penalty_until"])
        self.assertAlmostEqual((until - before).total_seconds(), 35 * 60, delta=5)

        blocked = self.request_as(
            "post", "/api/station-scan",
            {"code": f"t:{self.team.qr_token}|s:{self.station.id}|d:out"}, self.coop,
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["error"], "penalty_active")
        self.assertEqual(blocked.json()["penalty_until"], data["penalty_until"])
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, StationSession.STATUS_ACTIVE)

        # Once the penalty is over the same QR checks the team out.
        StationSession.objects.filter(id=self.session.id).update(
            penalty_until=timezone.now() - timedelta(seconds=1),
        )
        data = self.checkout()
        self.assertEqual(data["challenges"][0]["skipped"], True)
        self.assertEqual(data["challenges"][0]["points"], 0)
        self.assertEqual(data["challenges"][0]["skipPenaltyMinutes"], 35)

    def test_undo_clears_skip_and_penalty(self):
        self.skip("c1")
        response = self.skip("c1", undo=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["challenge_skips"], {})
        self.assertIsNone(response.json()["penalty_until"])
        self.assertEqual(response.json()["challenge_scores"], {})
        self.checkout()

    def test_penalties_queue_one_after_another(self):
        from api.services.station_service import _penalty_until
        start = timezone.now()
        until = _penalty_until({
            "c1": {"at": start.isoformat(), "minutes": 35},
            "c2": {"at": (start + timedelta(minutes=5)).isoformat(), "minutes": 15},
        })
        self.assertEqual(until, start + timedelta(minutes=50))

    def test_skip_needs_an_active_visit_and_a_real_challenge(self):
        self.assertEqual(self.skip("zz").status_code, 404)
        self.checkout()
        self.assertEqual(self.skip("c1").status_code, 409)

    def test_other_coop_cannot_skip(self):
        stranger = Account.objects.create(username="other", email="o@example.com", role="collab")
        self.assertEqual(self.skip("c1", actor=stranger).status_code, 403)

    def test_team_sees_penalty_and_stay_limit_but_no_points(self):
        self.station.max_stay_minutes = 90
        self.station.save()
        self.skip("c1")
        state = self.request_as("get", f"/api/my-team/station-state?station_id={self.station.id}").json()
        self.assertEqual(state["session"]["max_stay_minutes"], 90)
        self.assertIsNotNone(state["session"]["penalty_until"])
        self.assertNotIn("challenge_scores", json.dumps(state))

    def test_stay_limit_is_saved_and_cleared(self):
        url = f"/api/stations/{self.station.id}"
        response = self.request_as("patch", url, {"max_stay_minutes": 90}, self.master)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["max_stay_minutes"], 90)
        self.assertEqual(self.request_as("patch", url, {"max_stay_minutes": 0}, self.master).status_code, 400)
        response = self.request_as("patch", url, {"max_stay_minutes": None}, self.master)
        self.assertIsNone(response.json()["max_stay_minutes"])
