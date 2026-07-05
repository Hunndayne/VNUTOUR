import json

from django.test import TestCase

from api.models import (
    Account, Participant, PhaseRoster, ProgramPhase, Station, StationSubmission,
    SubEvent, Team, TeamMembership,
)
from api.services.auth_service import generate_session


class ParticipantFormsApiTests(TestCase):
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
            team=self.team,
            participant=self.participant,
            is_captain=True,
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying",
            label="Qualifying",
            order=2,
            is_current=True,
        )
        PhaseRoster.objects.create(
            phase=self.phase,
            team=self.team,
            origin=PhaseRoster.ORIGIN_APPROVED,
        )
        self.event = SubEvent.objects.create(
            phase=self.phase,
            name="Quiz Event",
            type=SubEvent.TYPE_QUIZ,
        )
        self.station = Station.objects.create(
            sub_event=self.event,
            code="Q01",
            name="Quiz Station",
            submission_config={
                "quiz": {
                    "enabled": True,
                    "items": [
                        {
                            "id": "q1",
                            "question": "Question?",
                            "options": ["A", "B"],
                            "correctOption": 1,
                        },
                    ],
                },
            },
        )
        self.token = generate_session(self.account)

    def test_forms_payload_hides_quiz_correct_option(self):
        response = self.client.get(
            "/api/my-team/forms",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        item = response.json()["accessible_forms"][0]
        quiz_item = item["submission_config"]["quiz"]["items"][0]
        self.assertNotIn("correctOption", quiz_item)

    def test_submit_form_creates_station_submission(self):
        response = self.client.post(
            f"/api/my-team/forms/{self.station.id}/submit",
            data=json.dumps({
                "response_payload": {
                    "quiz": [{"id": "q1", "selectedOption": 0}],
                },
                "attachment_payload": {"files": []},
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get(team=self.team, station=self.station)
        self.assertEqual(submission.status, StationSubmission.STATUS_SUBMITTED)
        self.assertEqual(submission.response_payload["quiz"][0]["selectedOption"], 0)
