import json
from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone

from api.models import Account, QuestionBankItem, Station, StationAssignment, StationSubmission, SubEvent, SystemSetting
from api.services.auth_service import generate_session
from api.services.submission_config_service import public_config
from api.services.question_bank_service import effective_quiz_items
from api.tests.test_participant_forms_api import FormsApiTestBase


class StationAnswerReviewTests(FormsApiTestBase):
    def setUp(self):
        super().setUp()
        self.event.end_date = timezone.now() + timedelta(hours=2)
        self.event.save(update_fields=["end_date"])
        self.station.submission_config = {
            "items": [
                {"id": "q1", "type": "quiz", "question": "Capital?",
                 "options": ["Hanoi", "Hue"], "correctOption": 0, "points": 3,
                 "explanation": "Hanoi is the capital."},
                {"id": "q2", "type": "text", "label": "Name it",
                 "correctText": ["Hanoi"], "points": 2, "explanation": "Text explanation."},
            ],
        }
        self.station.save()
        self.coop = Account.objects.create(username="reviewer", email="review@example.com", role="collab")
        StationAssignment.objects.create(collab=self.coop, station=self.station, active=True)
        self.admin = Account.objects.create(username="bankadmin", email="bank@example.com", role="admin")

    def request_as(self, method, url, body=None, actor=None):
        return getattr(self.client, method)(url, data=json.dumps(body) if body is not None else None,
            content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {generate_session(actor or self.account)}")

    def submit_answers(self):
        response = self._submit({"response_payload": {
            "quiz": [{"id": "q1", "selectedOption": 1}],
            "form": [{"id": "q2", "value": " hanoi "}],
            "answer_review": [{"question": "forged"}], "review_available_at": "2000-01-01T00:00:00Z",
        }})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotIn("answer_review", response.json())
        return StationSubmission.objects.get(id=response.json()["id"])

    def history(self):
        response = self.client.get('/api/my-team/question-history', HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["attempts"]

    def checkout(self):
        response = self.request_as("post", "/api/station-scan", {"code": f"t:{self.team.qr_token}|s:{self.station.id}|d:out"}, self.coop)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_checkout_shows_real_answers_and_summary_without_leaking_early(self):
        sub = self.submit_answers()
        self.assertEqual(self.history()[0]["review"]["items"], [])
        response = self.checkout()
        review = response["submission"]["response_payload"]["answer_review"]
        self.assertEqual(review[0]["selected_answer"], "Hue")
        self.assertEqual(review[0]["correct_answer"], "Hanoi")
        self.assertEqual(review[0]["explanation"], "Hanoi is the capital.")
        self.assertTrue(review[1]["is_correct"])
        self.assertEqual(response["submission"]["id"], sub.id)
        self.assertEqual(self.history()[0]["review"]["items"], [])
        with patch('api.services.submission_review_service.timezone.now', return_value=self.event.end_date):
            self.assertEqual(self.history()[0]["review"]["items"], review)
        state = self.client.get(f'/api/my-team/station-state?station_id={self.station.id}', HTTP_AUTHORIZATION=f"Bearer {self.token}").json()
        self.assertEqual(state["submission"]["quiz_result"]["correct_count"], 1)
        self.assertEqual(state["submission"]["quiz_result"]["total"], 2)
        self.assertNotIn("answer_review", str(state))

    def test_station_deadline_and_checkout_do_not_release_before_event_end(self):
        deadline = timezone.now() + timedelta(minutes=10)
        self.station.submission_config["limits"] = {"closesAt": deadline.isoformat()}
        self.station.save()
        self.submit_answers()
        self.checkout()
        self.station.submission_config = {}
        self.station.save()
        self.assertFalse(self.history()[0]["review"]["available"])
        with patch('api.services.submission_review_service.timezone.now', return_value=deadline + timedelta(seconds=14)):
            self.assertEqual(self.history()[0]["review"]["items"], [])
        with patch('api.services.submission_review_service.timezone.now', return_value=deadline + timedelta(seconds=16)):
            self.assertEqual(self.history()[0]["review"]["items"], [])
        with patch('api.services.submission_review_service.timezone.now', return_value=self.event.end_date - timedelta(microseconds=1)):
            self.assertFalse(self.history()[0]["review"]["available"])
        with patch('api.services.submission_review_service.timezone.now', return_value=self.event.end_date):
            self.assertEqual(len(self.history()[0]["review"]["items"]), 2)

    def test_duration_starts_at_checkin_and_cannot_be_spoofed(self):
        self.station.submission_config["limits"] = {"durationMinutes": 2}
        self.station.save()
        sub = self.submit_answers()
        expected = self.session.entered_at + timedelta(minutes=2)
        self.assertEqual(sub.response_payload["review_available_at"], expected.isoformat())
        self.assertFalse(self.history()[0]["review"]["available"])

    def test_history_is_own_team_only_and_survives_question_edits(self):
        sub = self.submit_answers()
        other = self._make_other_team()
        StationSubmission.objects.create(team=other, station=self.station, status='submitted', response_payload={"quiz_result": {"secret": True}})
        self.checkout()
        self.station.submission_config = {"items": []}
        self.station.save()
        with patch('api.services.submission_review_service.timezone.now', return_value=self.event.end_date):
            history = self.history()
        self.assertEqual([item["id"] for item in history], [sub.id])
        self.assertEqual(history[0]["review"]["items"][0]["correct_answer"], "Hanoi")

    def test_free_play_attempt_is_frozen_even_while_answers_remain_hidden(self):
        self.session.delete()
        self.station.checkin_policy = Station.POLICY_FREE_PLAY
        self.station.save()
        started = self.client.post(f'/api/my-team/forms/{self.station.id}/start',
            HTTP_AUTHORIZATION=f'Bearer {self.token}')
        self.assertEqual(started.status_code, 200, started.content)
        self.submit_answers()
        self.assertFalse(self.history()[0]["review"]["available"])
        response = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}]}})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "attempt_finished")

    def test_missing_event_end_keeps_answers_hidden_after_checkout(self):
        self.event.end_date = None
        self.event.save(update_fields=["end_date"])
        self.submit_answers()
        self.checkout()
        review = self.history()[0]["review"]
        self.assertEqual(review, {"available": False, "available_at": None, "items": []})

    def test_event_end_updates_apply_to_already_submitted_attempts(self):
        sub = self.submit_answers()
        self.checkout()
        original_end = self.event.end_date
        self.event.end_date += timedelta(hours=1)
        self.event.save(update_fields=["end_date"])
        with patch('api.services.submission_review_service.timezone.now', return_value=original_end):
            review = self.history()[0]["review"]
            self.assertFalse(review["available"])
            self.assertEqual(review["available_at"], self.event.end_date.isoformat())
        # Legacy submissions may store a station deadline long in the past.
        sub.response_payload["review_available_at"] = "2000-01-01T00:00:00Z"
        sub.save(update_fields=["response_payload"])
        self.assertFalse(self.history()[0]["review"]["available"])
        with patch('api.services.submission_review_service.timezone.now', return_value=self.event.end_date):
            self.assertEqual(len(self.history()[0]["review"]["items"]), 2)

    def test_changing_current_event_does_not_publish_previous_event_answers(self):
        self.submit_answers()
        self.checkout()
        other = SubEvent.objects.create(phase=self.phase, name="Next event", end_date=timezone.now())
        SystemSetting.objects.update_or_create(key="current_sub_event_id", defaults={"value": other.id})
        self.assertFalse(self.history()[0]["review"]["available"])

    def test_event_end_blocks_resubmission_even_before_station_edit_deadline(self):
        self.station.submission_config["limits"] = {"closesAt": (self.event.end_date + timedelta(hours=1)).isoformat()}
        self.station.save()
        self.submit_answers()
        self.event.end_date = timezone.now() - timedelta(seconds=1)
        self.event.save(update_fields=["end_date"])
        self.assertTrue(self.history()[0]["review"]["available"])
        response = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}]}})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "attempt_finished")

    def test_score_and_pass_fail_actions_update_the_submission(self):
        sub = self.submit_answers()
        self.checkout()
        url = f'/api/station-sessions/{self.session.id}/score'
        response = self.request_as('patch', url, {"score": 4}, self.coop)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.history()[0]["score"], 4)
        self.station.scoring_mode = Station.SCORING_PASS_FAIL
        self.station.pass_points = 7
        self.station.save()
        for outcome, expected in [('passed', 7), ('failed', 0)]:
            response = self.request_as('patch', url, {"outcome": outcome}, self.coop)
            self.assertEqual(response.status_code, 200)
            sub.refresh_from_db()
            self.assertEqual(sub.score, expected)
            self.assertEqual(sub.status, 'graded')

    def test_coop_marks_are_saved_with_the_score_and_shown_to_the_team(self):
        # q1 (3 pts) was answered wrong, q2 (2 pts) right; the coop accepts q1.
        sub = self.submit_answers()
        checkout = self.checkout()
        self.assertIsNone(checkout["submission"]["item_marks"])
        url = f'/api/station-sessions/{self.session.id}/score'
        response = self.request_as('patch', url, {"score": 5, "marks": {"q1": True, "q2": True}}, self.coop)
        self.assertEqual(response.status_code, 200, response.content)
        # Only the verdict that overrules the machine is stored.
        self.assertEqual(response.json()["item_marks"], {"q1": True})
        sub.refresh_from_db()
        self.assertEqual(sub.item_marks, {"q1": True})
        self.assertEqual(sub.score, 5)
        # The auto-grading snapshot itself is left untouched.
        self.assertFalse(sub.response_payload["answer_review"][0]["is_correct"])

        state = self.client.get(f'/api/my-team/station-state?station_id={self.station.id}', HTTP_AUTHORIZATION=f"Bearer {self.token}").json()
        self.assertEqual(state["submission"]["quiz_result"]["correct_count"], 2)
        attempt = self.history()[0]
        self.assertEqual(attempt["quiz_result"]["correct_count"], 2)
        self.assertEqual(attempt["quiz_result"]["points"], 5)
        self.assertEqual(attempt["review"]["items"], [])
        with patch('api.services.submission_review_service.timezone.now', return_value=self.event.end_date):
            q1 = self.history()[0]["review"]["items"][0]
        self.assertTrue(q1["is_correct"])
        self.assertFalse(q1["auto_is_correct"])
        self.assertTrue(q1["marked_by_coop"])

        # A later save without marks keeps them; null drops the coop's verdict.
        self.assertEqual(self.request_as('patch', url, {"score": 5}, self.coop).status_code, 200)
        sub.refresh_from_db()
        self.assertEqual(sub.item_marks, {"q1": True})
        self.assertEqual(self.request_as('patch', url, {"score": 2, "marks": {"q1": None}}, self.coop).status_code, 200)
        sub.refresh_from_db()
        self.assertIsNone(sub.item_marks)

    def test_invalid_marks_are_rejected_without_changing_the_score(self):
        sub = self.submit_answers()
        self.checkout()
        url = f'/api/station-sessions/{self.session.id}/score'
        for marks, error in [({"nope": True}, "unknown_mark_item"), ({"q1": "yes"}, "invalid_marks"), (["q1"], "invalid_marks")]:
            response = self.request_as('patch', url, {"score": 9, "marks": marks}, self.coop)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["error"], error)
        sub.refresh_from_db()
        self.assertIsNone(sub.item_marks)
        self.assertNotEqual(sub.score, 9)

    def test_unassigned_coop_cannot_checkout_or_see_review(self):
        self.submit_answers()
        StationAssignment.objects.all().delete()
        response = self.request_as('post', '/api/station-scan', {"code": f"t:{self.team.qr_token}|s:{self.station.id}|d:out"}, self.coop)
        self.assertEqual(response.status_code, 403)
        response = self.client.get(f'/api/stations/{self.station.id}/submissions', HTTP_AUTHORIZATION=f"Bearer {generate_session(self.coop)}")
        self.assertEqual(response.status_code, 403)

    def test_checkout_and_grading_one_team_leave_other_teams_active(self):
        self.station.capacity_mode = Station.CAPACITY_LIMITED
        self.station.max_concurrent_teams = 2
        self.station.save()
        sub = self.submit_answers()
        other = self._make_other_team()
        other_session = self._checkin(other)
        other_score = other_session.score
        other_sub = StationSubmission.objects.create(
            team=other, station=self.station, station_session=other_session,
            status='submitted', response_payload={"answer_review": [{"id": "other-team-only"}]},
        )
        result = self.checkout()
        self.assertEqual(result['submission']['id'], sub.id)
        self.assertNotIn('other-team-only', str(result))
        response = self.request_as('patch', f'/api/station-sessions/{self.session.id}/score', {"score": 3}, self.coop)
        self.assertEqual(response.status_code, 200)
        other_session.refresh_from_db()
        other_sub.refresh_from_db()
        self.assertEqual(other_session.status, 'active')
        self.assertEqual(other_session.score, other_score)
        self.assertIsNone(other_sub.score)
        occupancy = self.client.get(f'/api/stations/{self.station.id}/occupancy', HTTP_AUTHORIZATION=f"Bearer {generate_session(self.coop)}").json()
        self.assertEqual(occupancy['active_sessions'], 1)
        self.assertFalse(occupancy['is_full'])
        third = self._make_other_team('T0003')
        enter = self.request_as('post', '/api/station-sessions/enter', {
            "code": third.code, "stationId": self.station.id,
            "phaseKey": self.phase.key, "eventId": self.event.id,
        }, self.coop)
        self.assertEqual(enter.status_code, 201, enter.content)
        other_session.refresh_from_db()
        self.assertEqual(other_session.status, 'active')

    def test_public_configs_strip_explanations_from_inline_and_bank_questions(self):
        item = QuestionBankItem.objects.create(sub_event=self.event, question='Bank', options=['A','B'], correct_option=0, explanation='Secret bank explanation')
        self.station.submission_config['bank'] = {"itemIds": [item.id]}
        result = public_config(self.station.submission_config, effective_quiz_items=effective_quiz_items(self.station))
        self.assertEqual(len(result['items']), 3)
        for question in result['items']:
            self.assertNotIn('explanation', question)
            self.assertNotIn('correctOption', question)
            self.assertNotIn('correctText', question)

    def test_bank_replace_validates_before_delete_and_supports_explanation_crud(self):
        old = QuestionBankItem.objects.create(sub_event=self.event, question='Old', options=['A','B'])
        url = f'/api/program/sub-events/{self.event.id}/question-bank'
        invalid = self.request_as('post', url, {"mode": "replace", "items": [{"question": "Bad", "options": []}]}, self.admin)
        self.assertEqual(invalid.status_code, 400)
        self.assertTrue(QuestionBankItem.objects.filter(id=old.id).exists())
        valid = self.request_as('post', url, {"mode": "replace", "items": [{"question": "New", "options": ['A','B'], "correctOption": 1, "explanation": "Because B"}]}, self.admin)
        self.assertEqual(valid.status_code, 200)
        item = QuestionBankItem.objects.get(sub_event=self.event)
        self.assertEqual(item.explanation, 'Because B')
        updated = self.request_as('put', f'{url}/{item.id}', {"explanation": "New explanation"}, self.admin)
        self.assertEqual(updated.json()['explanation'], 'New explanation')
        self.assertEqual(self.request_as('delete', url, actor=self.admin).status_code, 200)
        self.assertFalse(QuestionBankItem.objects.filter(sub_event=self.event).exists())
