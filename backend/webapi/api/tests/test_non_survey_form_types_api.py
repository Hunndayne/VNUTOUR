"""Survey isolation must preserve shared team forms for every other event type."""
import json

from api.models import (
    Account, Participant, StationSubmission, SubEvent, SurveyFormSession,
    TeamMembership,
)
from api.services.auth_service import generate_session
from api.tests.test_participant_forms_api import FormsApiTestBase


class NonSurveyFormTypesApiTests(FormsApiTestBase):
    def setUp(self):
        super().setUp()
        account = Account.objects.create(
            username="member", email="member@example.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="SV002",
        )
        participant = Participant.objects.create(
            account=account, mssv="SV002", full_name="Member", email=account.email,
        )
        TeamMembership.objects.create(team=self.team, participant=participant)
        self.member_token = generate_session(account)

    def event_types(self):
        return [kind for kind, _ in SubEvent.TYPE_CHOICES if kind != SubEvent.TYPE_SURVEY]

    def use_type(self, kind):
        self.event.type = kind
        self.event.save(update_fields=["type"])

    def test_all_other_event_types_keep_one_submission_per_team_attempt(self):
        for kind in self.event_types():
            with self.subTest(event_type=kind):
                self.use_type(kind)
                first = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}]}})
                self.assertEqual(first.status_code, 201, first.content)
                forms = self.client.get(
                    "/api/my-team/forms", HTTP_AUTHORIZATION=f"Bearer {self.member_token}",
                )
                self.assertEqual(forms.status_code, 200)
                form = forms.json()["accessible_forms"][0]
                self.assertFalse(form["is_survey"])
                self.assertEqual(form["my_submission"]["status"], "submitted")
                second = self.client.post(
                    f"/api/my-team/forms/{self.station.id}/submit",
                    data=json.dumps({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 1}]}}),
                    content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {self.member_token}",
                )
                self.assertEqual(second.status_code, 201, second.content)
                self.assertEqual(first.json()["id"], second.json()["id"])
                submission = StationSubmission.objects.get(station=self.station)
                self.assertIsNone(submission.participant_id)
                self.assertEqual(submission.station_session_id, self.session.id)
                self.assertIs(submission.is_correct, True)
                self.assertFalse(SurveyFormSession.objects.exists())
                submission.delete()

    def test_all_other_event_types_share_drafts_between_teammates(self):
        url = f"/api/my-team/stations/{self.station.id}/draft"
        for kind in self.event_types():
            with self.subTest(event_type=kind):
                self.use_type(kind)
                answers = {"quiz:q1": 1, "note": kind}
                saved = self.client.put(
                    url, data=json.dumps({"response": answers}), content_type="application/json",
                    HTTP_AUTHORIZATION=f"Bearer {self.token}",
                )
                self.assertEqual(saved.status_code, 200, saved.content)
                loaded = self.client.get(url, HTTP_AUTHORIZATION=f"Bearer {self.member_token}")
                self.assertEqual(loaded.status_code, 200)
                self.assertFalse(loaded.json()["is_survey"])
                self.assertEqual(loaded.json()["response"], answers)

    def test_all_other_event_types_still_require_a_station_checkin(self):
        self.session.delete()
        for kind in self.event_types():
            with self.subTest(event_type=kind):
                self.use_type(kind)
                response = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 1}]}})
                self.assertEqual(response.status_code, 403, response.content)
                self.assertEqual(response.json()["error"], "not_checked_in")
        self.assertFalse(StationSubmission.objects.exists())
