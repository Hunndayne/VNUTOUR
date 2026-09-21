import json
from datetime import timedelta

from django.utils import timezone

from api.models import (
    Account, Participant, ScoreEntry, Station, StationSession, StationSubmission,
    SubEvent, SurveyFormSession, SystemSetting, TeamFormSession, TeamMembership,
)
from api.services.auth_service import generate_session
from api.services.station_service import get_event_replay_state
from api.tests.test_participant_forms_api import FormsApiTestBase


class IndividualSurveyApiTests(FormsApiTestBase):
    def setUp(self):
        super().setUp()
        self.event.type = SubEvent.TYPE_SURVEY
        self.event.save(update_fields=["type"])
        self.station.submission_config = {
            "items": [{"id": "s1", "type": "text", "label": "Feedback"}],
        }
        self.station.save(update_fields=["submission_config"])
        account = Account.objects.create(
            username="member", email="member@example.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="SV002",
        )
        self.member = Participant.objects.create(
            account=account, mssv="SV002", full_name="Member", email=account.email,
        )
        TeamMembership.objects.create(team=self.team, participant=self.member)
        self.member_token = generate_session(account)

    def submit_as(self, token, answer):
        return self.client.post(
            f"/api/my-team/forms/{self.station.id}/submit",
            data=json.dumps({"response_payload": {"form": [{"id": "s1", "value": answer}]}}),
            content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def form_as(self, token):
        response = self.client.get("/api/my-team/forms", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(response.status_code, 200)
        return response.json()["accessible_forms"][0]

    def test_teammates_create_separate_responses(self):
        first = self.submit_as(self.token, "Captain feedback")
        second = self.submit_as(self.member_token, "Member feedback")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(StationSubmission.objects.filter(station=self.station).count(), 2)
        captain_submission = StationSubmission.objects.get(id=first.json()["id"])
        member_submission = StationSubmission.objects.get(id=second.json()["id"])
        self.assertEqual(captain_submission.participant_id, self.participant.id)
        self.assertEqual(member_submission.participant_id, self.member.id)
        self.assertEqual(captain_submission.response_payload["form"][0]["value"], "Captain feedback")
        self.assertEqual(member_submission.response_payload["form"][0]["value"], "Member feedback")

    def test_teammate_submission_does_not_mark_my_survey_completed(self):
        self.assertEqual(self.submit_as(self.token, "Captain feedback").status_code, 201)
        self.assertIsNotNone(self.form_as(self.token)["my_submission"])
        self.assertIsNone(self.form_as(self.member_token)["my_submission"])

    def test_survey_does_not_require_or_close_a_team_attempt(self):
        self.station.checkin_policy = Station.POLICY_FREE_PLAY
        self.station.submission_config["flow"] = {"checkoutAfterSubmit": False}
        self.station.save()
        self.assertEqual(self.submit_as(self.token, "Feedback").status_code, 201)
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, StationSession.STATUS_ACTIVE)
        self.assertIsNone(StationSubmission.objects.get().station_session_id)
        self.session.delete()
        self.assertEqual(self.submit_as(self.member_token, "Other feedback").status_code, 201)
        self.assertFalse(StationSession.objects.exists())
        self.assertFalse(ScoreEntry.objects.exists())
        replay = get_event_replay_state(self.team, self.event)["by_station"][self.station.id]
        self.assertEqual(replay["attempts_used"], 0)

    def test_survey_submission_limit_is_individual(self):
        self.station.submission_config["limits"] = {"maxSubmissions": 1}
        self.station.save()
        self.assertEqual(self.submit_as(self.token, "First").status_code, 201)
        self.assertTrue(self.form_as(self.token)["closure"]["closed"])
        member_form = self.form_as(self.member_token)
        self.assertFalse(member_form["closure"]["closed"])
        self.assertEqual(member_form["closure"]["submitted_count"], 0)
        self.assertEqual(self.submit_as(self.member_token, "Second").status_code, 201)

    def test_resubmitting_cannot_overwrite_a_response(self):
        self.assertEqual(self.submit_as(self.token, "Original").status_code, 201)
        self.assertEqual(self.submit_as(self.token, "Replacement").status_code, 409)
        self.assertEqual(StationSubmission.objects.get().response_payload["form"][0]["value"], "Original")

    def test_survey_timers_start_independently_and_are_idempotent(self):
        self.station.checkin_policy = Station.POLICY_FREE_PLAY
        self.station.submission_config["limits"] = {"durationSeconds": 60}
        self.station.save()
        self.session.delete()
        self.assertTrue(self.form_as(self.token)["requires_start"])
        start_url = f"/api/my-team/forms/{self.station.id}/start"
        first = self.client.post(start_url, HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(first.status_code, 200)
        self.assertFalse(self.form_as(self.token)["requires_start"])
        self.assertTrue(self.form_as(self.member_token)["requires_start"])
        repeated = self.client.post(start_url, HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(first.json()["started_at"], repeated.json()["started_at"])
        SurveyFormSession.objects.filter(participant=self.participant).update(
            started_at=timezone.now() - timedelta(minutes=2),
        )
        second = self.client.post(start_url, HTTP_AUTHORIZATION=f"Bearer {self.member_token}")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(self.form_as(self.token)["closure"]["reason"], "time_closed")
        self.assertFalse(self.form_as(self.member_token)["closure"]["closed"])
        self.assertEqual(self.submit_as(self.token, "Late").status_code, 409)
        self.assertEqual(self.submit_as(self.member_token, "On time").status_code, 201)
        self.assertFalse(TeamFormSession.objects.exists())
        self.assertFalse(StationSession.objects.exists())

    def test_legacy_survey_response_is_preserved_without_attributing_it(self):
        legacy = StationSubmission.objects.create(
            team=self.team, station=self.station, station_session=self.session,
            status=StationSubmission.STATUS_SUBMITTED, response_payload={"form": []},
        )
        self.assertIsNone(self.form_as(self.token)["my_submission"])
        self.assertEqual(self.submit_as(self.token, "Personal response").status_code, 201)
        legacy.refresh_from_db()
        self.assertIsNone(legacy.participant_id)
        self.assertEqual(legacy.response_payload, {"form": []})
        self.assertEqual(StationSubmission.objects.count(), 2)

    def test_admin_sees_respondents_and_cannot_grade_survey(self):
        self.submit_as(self.token, "Captain")
        self.submit_as(self.member_token, "Member")
        admin = Account.objects.create(
            username="survey-admin", email="admin@example.com", password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        headers = {"HTTP_AUTHORIZATION": f"Bearer {generate_session(admin)}"}
        response = self.client.get(f"/api/stations/{self.station.id}/submissions", **headers)
        self.assertEqual(response.status_code, 200)
        rows = response.json()["submissions"]
        self.assertEqual({r["participant_mssv"] for r in rows}, {"SV001", "SV002"})
        self.assertEqual({r["participant_name"] for r in rows}, {"Captain", "Member"})
        self.assertTrue(all(r["is_survey"] for r in rows))
        response = self.client.patch(
            f'/api/submissions/{rows[0]["id"]}/grade', data=json.dumps({"score": 100}),
            content_type="application/json", **headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "survey_not_graded")
        self.assertFalse(ScoreEntry.objects.exists())

    def test_other_members_do_not_see_personal_survey_in_team_state(self):
        SystemSetting.objects.update_or_create(
            key="current_sub_event_id", defaults={"value": str(self.event.id)},
        )
        self.submit_as(self.token, "Private feedback")
        response = self.client.get(
            f"/api/my-team/station-state?station_id={self.station.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.member_token}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["submission"])
        own_state = self.client.get(
            f"/api/my-team/station-state?station_id={self.station.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(own_state.status_code, 200)
        self.assertIsNotNone(own_state.json()["submission"])
        experience = self.client.get(
            "/api/me/experience", HTTP_AUTHORIZATION=f"Bearer {self.member_token}",
        )
        self.assertEqual(experience.status_code, 200)
        self.assertIsNone(experience.json()["open_forms"][0]["my_submission"])
        self.assertEqual(experience.json()["open_forms"][0]["participant_id"], self.member.id)
        response = self.client.get(
            "/api/my-team/question-history", HTTP_AUTHORIZATION=f"Bearer {self.member_token}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["attempts"], [])

    def test_survey_quiz_does_not_award_team_points(self):
        self.station.submission_config = {"quiz": {
            "enabled": True, "autoScore": True,
            "items": [{"id": "q1", "question": "Opinion?", "options": ["A", "B"], "correctOption": 0}],
        }}
        self.station.save()
        response = self._submit({"response_payload": {
            "quiz": [{"id": "q1", "selectedOption": 0}], "quiz_result": {"points": 999},
        }})
        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get()
        self.assertIsNone(submission.is_correct)
        self.assertNotIn("quiz_result", submission.response_payload)
        self.assertFalse(ScoreEntry.objects.exists())
