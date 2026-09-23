"""Individual surveys retain the same detailed question view as team forms."""
from api.models import Account, StationSubmission, SubEvent
from api.services.auth_service import generate_session
from api.tests.test_participant_forms_api import FormsApiTestBase


class SurveyAnswerReviewTests(FormsApiTestBase):
    def setUp(self):
        super().setUp()
        self.event.type = SubEvent.TYPE_SURVEY
        self.event.save(update_fields=["type"])
        self.station.submission_config = {"items": [
            {"id": "t1", "type": "text", "label": "Your favourite memory?"},
            {"id": "q1", "type": "quiz", "question": "Join next year?",
             "options": ["Yes", "No", "Maybe", "I want to create new challenges"],
             "correctOption": 3, "points": 5, "explanation": "A grading explanation"},
        ]}
        self.station.save(update_fields=["submission_config"])
        admin = Account.objects.create(username="review-admin", role=Account.ROLE_ADMIN)
        self.admin_token = generate_session(admin)

    def submit_feedback(self):
        response = self._submit({"response_payload": {
            "form": [{"id": "t1", "value": "The final round"}],
            "quiz": [{"id": "q1", "selectedOption": 3}],
        }})
        self.assertEqual(response.status_code, 201)
        return StationSubmission.objects.get(id=response.json()["id"])

    def admin_review(self):
        response = self.client.get(
            f"/api/stations/{self.station.id}/submissions",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["submissions"][0]["answer_review"]

    def assert_feedback_review(self, review):
        self.assertEqual([item["id"] for item in review], ["t1", "q1"])
        self.assertEqual(review[0]["question"], "Your favourite memory?")
        self.assertEqual(review[0]["selected_answer"], "The final round")
        self.assertEqual(review[1]["selected_answer"], "I want to create new challenges")
        for item in review:
            self.assertIsNone(item["is_correct"])
            self.assertIsNone(item["correct_answer"])
            self.assertEqual(item["points"], 0)

    def test_new_survey_stores_and_serves_detailed_ungraded_answers(self):
        submission = self.submit_feedback()
        self.assert_feedback_review(self.admin_review())
        self.assert_feedback_review(submission.response_payload["answer_review"])

    def test_existing_survey_with_empty_review_is_rebuilt_without_changing_answers(self):
        submission = self.submit_feedback()
        for missing_snapshot in (False, True):
            with self.subTest(missing_snapshot=missing_snapshot):
                if missing_snapshot:
                    submission.response_payload.pop("answer_review", None)
                else:
                    submission.response_payload["answer_review"] = []
                submission.save(update_fields=["response_payload"])
                original = submission.response_payload.copy()
                self.assert_feedback_review(self.admin_review())
                submission.refresh_from_db()
                self.assertEqual(submission.response_payload, original)

    def test_new_survey_snapshot_survives_question_and_option_edits(self):
        self.submit_feedback()
        self.station.submission_config["items"][0]["label"] = "Changed question"
        self.station.submission_config["items"][1]["options"][3] = "Changed option"
        self.station.save(update_fields=["submission_config"])
        self.assert_feedback_review(self.admin_review())

    def test_legacy_graded_survey_snapshot_keeps_answers_without_grading_metadata(self):
        submission = self.submit_feedback()
        review = submission.response_payload["answer_review"]
        review[1].update(is_correct=True, correct_answer="Old answer key", points=5)
        submission.save(update_fields=["response_payload"])
        self.station.submission_config["items"][1]["options"][3] = "Changed option"
        self.station.save(update_fields=["submission_config"])
        self.assert_feedback_review(self.admin_review())
        submission.refresh_from_db()
        self.assertEqual(submission.response_payload["answer_review"][1]["points"], 5)
