import json
import shutil
import tempfile
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from api.models import (
    Account, Participant, PhaseRoster, ProgramPhase, Station, StationSubmission,
    SubEvent, Team, TeamMembership,
)
from api.services.auth_service import generate_session


class FormsApiTestBase(TestCase):
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

    def _make_other_team(self, code="T0002"):
        team = Team.objects.create(
            code=code,
            name=f"Team {code}",
            approval_status=Team.APPROVAL_APPROVED,
            qr_token=f"token-{code}",
        )
        PhaseRoster.objects.create(
            phase=self.phase,
            team=team,
            origin=PhaseRoster.ORIGIN_APPROVED,
        )
        return team

    def _submit(self, payload):
        return self.client.post(
            f"/api/my-team/forms/{self.station.id}/submit",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )


class ParticipantFormsApiTests(FormsApiTestBase):
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
        response = self._submit({
            "response_payload": {
                "quiz": [{"id": "q1", "selectedOption": 0}],
            },
            "attachment_payload": {"files": []},
        })

        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get(team=self.team, station=self.station)
        self.assertEqual(submission.status, StationSubmission.STATUS_SUBMITTED)
        self.assertEqual(submission.response_payload["quiz"][0]["selectedOption"], 0)
        self.assertIs(submission.is_correct, False)

    def test_submit_grades_quiz_correct(self):
        response = self._submit({
            "response_payload": {
                "quiz": [{"id": "q1", "selectedOption": 1}],
            },
        })

        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get(team=self.team, station=self.station)
        self.assertIs(submission.is_correct, True)

    def test_forms_payload_includes_closure_and_my_submission(self):
        self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}]}})

        response = self.client.get(
            "/api/my-team/forms",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        item = response.json()["accessible_forms"][0]
        self.assertFalse(item["closure"]["closed"])
        self.assertEqual(item["closure"]["submitted_count"], 1)
        self.assertEqual(item["my_submission"]["status"], "submitted")

    def test_submit_rejected_when_submission_limit_reached(self):
        self.station.submission_config = {
            **self.station.submission_config,
            "limits": {"maxSubmissions": 1},
        }
        self.station.save()
        other_team = self._make_other_team()
        StationSubmission.objects.create(
            team=other_team,
            station=self.station,
            status=StationSubmission.STATUS_SUBMITTED,
        )

        response = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 1}]}})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "form_closed")
        self.assertEqual(response.json()["reason"], "limit_reached")

    def test_submit_rejected_after_correct_answer_when_close_on_correct(self):
        self.station.submission_config = {
            **self.station.submission_config,
            "limits": {"closeOnCorrect": True},
        }
        self.station.save()
        other_team = self._make_other_team()
        StationSubmission.objects.create(
            team=other_team,
            station=self.station,
            status=StationSubmission.STATUS_SUBMITTED,
            is_correct=True,
        )

        response = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 1}]}})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["reason"], "correct_answer")

    def test_submit_rejected_when_manually_closed(self):
        self.station.submission_config = {
            **self.station.submission_config,
            "limits": {"manualClosed": True},
        }
        self.station.save()

        response = self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 1}]}})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["reason"], "manual")


class ParticipantFormsUploadTests(FormsApiTestBase):
    def setUp(self):
        super().setUp()
        self.media_root = tempfile.mkdtemp(prefix="vnutour-media-")
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        self.station.submission_config = {
            **self.station.submission_config,
            "attachment": {
                "enabled": True,
                "maxFiles": 1,
                "maxSizeMb": 1,
                "allowedTypes": "PNG, JPG",
            },
        }
        self.station.save()

    def _submit_multipart(self, files):
        return self.client.post(
            f"/api/my-team/forms/{self.station.id}/submit",
            data={
                "response_payload": json.dumps({"quiz": [{"id": "q1", "selectedOption": 1}]}),
                "files": files,
            },
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_multipart_upload_stores_file_locally(self):
        with override_settings(MEDIA_ROOT=self.media_root):
            response = self._submit_multipart(
                [SimpleUploadedFile("proof.png", b"png-bytes", content_type="image/png")],
            )

        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get(team=self.team, station=self.station)
        stored = submission.attachment_payload["files"][0]
        self.assertEqual(stored["name"], "proof.png")
        self.assertEqual(stored["storage"], "local")
        self.assertTrue((Path(self.media_root) / stored["key"]).exists())

    def test_multipart_upload_rejects_disallowed_extension(self):
        with override_settings(MEDIA_ROOT=self.media_root):
            response = self._submit_multipart(
                [SimpleUploadedFile("payload.exe", b"binary", content_type="application/octet-stream")],
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "file_type_not_allowed")

    def test_multipart_upload_rejects_too_many_files(self):
        with override_settings(MEDIA_ROOT=self.media_root):
            response = self._submit_multipart([
                SimpleUploadedFile("a.png", b"a", content_type="image/png"),
                SimpleUploadedFile("b.png", b"b", content_type="image/png"),
            ])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "too_many_files")
