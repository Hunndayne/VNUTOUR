"""Offline challenges at a station, and the per-station "show score" switch.

A challenge is scored by a coop (0..maxPoints); the visit's score is the form
part plus every challenge. Participants only ever see "Thử thách N".
"""

import json
from datetime import timedelta
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
