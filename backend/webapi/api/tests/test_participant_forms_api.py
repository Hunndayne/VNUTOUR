import json
import shutil
import tempfile
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from api.models import (
    Account, Participant, PhaseRoster, ProgramPhase, ScoreEntry, Station,
    StationSubmission, SubEvent, SystemSetting, Team, TeamFormVariant, TeamMembership,
)
from api.services import team_form_variant_service as variant_service
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
        quiz_items = [
            entry for entry in item["submission_config"]["items"]
            if entry["type"] == "quiz"
        ]
        self.assertNotIn("correctOption", quiz_items[0])

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

    def test_submit_stores_weighted_quiz_result(self):
        self.station.submission_config = {
            "quiz": {
                "enabled": True,
                "items": [
                    {"id": "q1", "question": "A?", "options": ["A", "B"], "correctOption": 1, "points": 2},
                    {"id": "q2", "question": "B?", "options": ["A", "B"], "correctOption": 0, "points": 3},
                ],
            },
        }
        self.station.save()

        response = self._submit({
            "response_payload": {
                "quiz": [
                    {"id": "q1", "selectedOption": 1},
                    {"id": "q2", "selectedOption": 1},
                ],
                "quiz_result": {"points": 9999},
            },
        })

        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get(team=self.team, station=self.station)
        result = submission.response_payload["quiz_result"]
        self.assertEqual(result["correct_count"], 1)
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["points"], 2)
        self.assertEqual(result["max_points"], 5)
        self.assertFalse(result["all_correct"])
        self.assertIs(submission.is_correct, False)
        # Không tự cộng điểm khi chưa bật autoScore
        self.assertIsNone(submission.score)
        self.assertFalse(ScoreEntry.objects.filter(team=self.team).exists())

    def test_submit_with_auto_score_writes_score_entry(self):
        self.station.submission_config = {
            "quiz": {
                "enabled": True,
                "autoScore": True,
                "items": [
                    {"id": "q1", "question": "A?", "options": ["A", "B"], "correctOption": 1, "points": 5},
                ],
            },
        }
        self.station.save()

        response = self._submit({
            "response_payload": {"quiz": [{"id": "q1", "selectedOption": 1}]},
        })

        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get(team=self.team, station=self.station)
        self.assertEqual(submission.score, 5)
        entry = ScoreEntry.objects.get(submission=submission)
        self.assertEqual(entry.points, 5)
        self.assertEqual(entry.kind, ScoreEntry.KIND_STATION)

        # Nộp lại với đáp án sai: cùng entry được cập nhật về 0, không nhân đôi
        self._submit({
            "response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}]},
        })
        entries = ScoreEntry.objects.filter(team=self.team)
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().points, 0)

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


class SubmissionItemOrderTests(FormsApiTestBase):
    """The admin-chosen item order must survive to the participant payload."""

    MIXED_ITEMS = [
        {"id": "t1", "type": "text", "label": "Mo ta cach giai"},
        {"id": "q1", "type": "quiz", "question": "Q1?",
         "options": ["A", "B"], "correctOption": 1, "points": 3},
        {"id": "f1", "type": "attachment", "maxFiles": 2, "maxSizeMb": 5,
         "allowedTypes": "PNG"},
        {"id": "q2", "type": "quiz", "question": "Q2?",
         "options": ["A", "B"], "correctOption": 0, "points": 2},
        {"id": "t2", "type": "text", "label": "Ghi chu", "required": False},
    ]

    def _set_items(self, items):
        self.station.submission_config = {"items": items}
        self.station.save(update_fields=["submission_config"])

    def _forms_payload(self):
        response = self.client.get(
            "/api/my-team/forms",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["accessible_forms"][0]["submission_config"]

    def test_interleaved_item_order_is_preserved(self):
        self._set_items(self.MIXED_ITEMS)

        config = self._forms_payload()

        self.assertEqual(
            [(item["id"], item["type"]) for item in config["items"]],
            [("t1", "text"), ("q1", "quiz"), ("f1", "attachment"),
             ("q2", "quiz"), ("t2", "text")],
        )

    def test_attachment_may_sit_anywhere_in_the_order(self):
        self._set_items([
            {"id": "f1", "type": "attachment", "maxFiles": 1},
            {"id": "t1", "type": "text", "label": "Sau o nop tep"},
        ])

        config = self._forms_payload()

        self.assertEqual(config["items"][0]["type"], "attachment")
        self.assertEqual(config["items"][1]["id"], "t1")

    def test_public_payload_strips_answers_from_every_quiz_item(self):
        self._set_items(self.MIXED_ITEMS)

        config = self._forms_payload()

        quiz_items = [item for item in config["items"] if item["type"] == "quiz"]
        self.assertEqual(len(quiz_items), 2)
        for item in quiz_items:
            self.assertNotIn("correctOption", item)

    def test_quiz_graded_across_interleaved_items_with_weights(self):
        self._set_items(self.MIXED_ITEMS)

        response = self._submit({
            "response_payload": {
                "quiz": [
                    {"id": "q1", "selectedOption": 1},
                    {"id": "q2", "selectedOption": 1},
                ],
            },
        })

        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get(team=self.team, station=self.station)
        result = submission.response_payload["quiz_result"]
        self.assertEqual(result["correct_count"], 1)
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["points"], 3)
        self.assertEqual(result["max_points"], 5)
        self.assertFalse(result["all_correct"])
        self.assertFalse(submission.is_correct)

    def test_second_attachment_item_is_dropped(self):
        self._set_items([
            {"id": "f1", "type": "attachment", "maxFiles": 1},
            {"id": "f2", "type": "attachment", "maxFiles": 9},
        ])

        config = self._forms_payload()

        attachments = [item for item in config["items"] if item["type"] == "attachment"]
        self.assertEqual([item["id"] for item in attachments], ["f1"])

    def test_legacy_section_config_converts_to_items_in_display_order(self):
        self.station.submission_config = {
            "form": {"enabled": True, "fields": [{"id": "old-f", "label": "Truong cu"}]},
            "quiz": {"enabled": True, "items": [
                {"id": "old-q", "question": "Cau cu", "options": ["A"], "correctOption": 0},
            ]},
            "attachment": {"enabled": True, "maxFiles": 3},
        }
        self.station.save(update_fields=["submission_config"])

        config = self._forms_payload()

        self.assertEqual(
            [(item["id"], item["type"]) for item in config["items"]],
            [("old-f", "text"), ("old-q", "quiz"), ("file-0", "attachment")],
        )

    def test_legacy_disabled_sections_produce_no_items(self):
        self.station.submission_config = {
            "form": {"enabled": False, "fields": [{"id": "old-f", "label": "An"}]},
            "quiz": {"enabled": False, "items": [{"id": "old-q", "question": "An"}]},
            "attachment": {"enabled": False},
        }
        self.station.save(update_fields=["submission_config"])

        response = self.client.get(
            "/api/my-team/forms",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["accessible_forms"], [])

    def test_saving_a_station_persists_the_canonical_item_shape(self):
        admin = Account.objects.create(
            username="admin-cfg",
            email="admin-cfg@example.com",
            password_hash="x",
            role=Account.ROLE_MASTER_ADMIN,
        )
        admin_token = generate_session(admin)

        response = self.client.patch(
            f"/api/stations/{self.station.id}",
            data=json.dumps({"submission_config": {
                "form": {"enabled": True, "fields": [{"id": "legacy", "label": "Cu"}]},
            }}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        self.station.refresh_from_db()
        stored = self.station.submission_config
        self.assertNotIn("form", stored)
        self.assertEqual(
            [(item["id"], item["type"]) for item in stored["items"]],
            [("legacy", "text")],
        )


class AnswerLeakTests(FormsApiTestBase):
    """Nothing a participant can reach may carry the correct answer."""

    # Every spelling `public_config` strips, plus the raw model field name.
    ANSWER_KEYS = {
        "correctOption", "correct_option", "correctAnswer", "correct_answer", "answer",
    }

    def setUp(self):
        super().setUp()
        self.station.checkin_policy = Station.POLICY_FREE_PLAY
        self.station.submission_config = {
            "items": [
                {"id": "q1", "type": "quiz", "question": "2+2?",
                 "options": ["3", "4", "5"], "correctOption": 1},
                {"id": "q2", "type": "quiz", "question": "Thu do?",
                 "options": ["Ha Noi", "Hue"], "correctOption": 0},
                {"id": "t1", "type": "text", "label": "Giai thich"},
            ],
        }
        self.station.save(update_fields=["checkin_policy", "submission_config"])
        SystemSetting.objects.update_or_create(
            key="current_sub_event_id", defaults={"value": str(self.event.id)},
        )

    def _keys_anywhere(self, node, found=None):
        """Every dict key in a nested structure, so nothing hides in a subtree."""
        found = set() if found is None else found
        if isinstance(node, dict):
            found.update(node.keys())
            for value in node.values():
                self._keys_anywhere(value, found)
        elif isinstance(node, list):
            for value in node:
                self._keys_anywhere(value, found)
        return found

    def _get(self, path):
        response = self.client.get(path, HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(response.status_code, 200)
        return response

    def test_my_team_forms_carries_questions_but_no_answers(self):
        response = self._get("/api/my-team/forms")
        payload = response.json()

        quiz = [
            item for form in payload["accessible_forms"]
            for item in form["submission_config"]["items"]
            if item["type"] == "quiz"
        ]
        self.assertEqual(len(quiz), 2)
        # The questions and the options do arrive — the form has to be answerable.
        self.assertEqual(quiz[0]["question"], "2+2?")
        self.assertEqual(quiz[0]["options"], ["3", "4", "5"])
        # ...but no key anywhere in the response names the right one.
        self.assertEqual(self._keys_anywhere(payload) & self.ANSWER_KEYS, set())

    def test_experience_endpoint_leaks_no_answers_either(self):
        """The dashboard embeds the same form payload, so it needs the same check."""
        payload = self._get("/api/me/experience").json()

        self.assertTrue(payload["open_forms"], "fixture must actually return a form")
        self.assertEqual(self._keys_anywhere(payload) & self.ANSWER_KEYS, set())

    def _stations_listing_as(self, token):
        return self.client.get(
            f"/api/program/phases/{self.phase.key}/sub-events/{self.event.id}/stations",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def test_participant_cannot_read_the_raw_station_config(self):
        self.assertEqual(self._stations_listing_as(self.token).status_code, 403)

    def _staff_token(self, username, role):
        account = Account.objects.create(
            username=username, email=f"{username}@example.com",
            password_hash="x", role=role,
        )
        return generate_session(account)

    def test_admins_do_see_the_answers_in_the_stations_listing(self):
        """Control for the tests above: prove the fixture has an answer to leak.

        Without this, stripping could look correct simply because no answer was
        ever configured. Admins edit the forms from this payload, so they need it.
        """
        token = self._staff_token("cfg-admin", Account.ROLE_ADMIN)

        payload = self._stations_listing_as(token).json()

        items = payload["stations"][0]["submission_config"]["items"]
        answers = [item["correctOption"] for item in items if item["type"] == "quiz"]
        self.assertEqual(answers, [1, 0])

    def test_collabs_get_the_stations_listing_without_the_answers(self):
        """A collab runs the station; grading uses the server-computed result."""
        token = self._staff_token("run-collab", Account.ROLE_COLLAB)

        response = self._stations_listing_as(token)
        payload = response.json()

        self.assertEqual(response.status_code, 200)
        items = payload["stations"][0]["submission_config"]["items"]
        quiz = [item for item in items if item["type"] == "quiz"]
        # The questions still arrive — a collab may need to read them aloud.
        self.assertEqual([item["question"] for item in quiz], ["2+2?", "Thu do?"])
        self.assertEqual(self._keys_anywhere(payload) & self.ANSWER_KEYS, set())

    def test_submit_response_does_not_echo_the_answers(self):
        response = self._submit({
            "response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}]},
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(self._keys_anywhere(response.json()) & self.ANSWER_KEYS, set())

    def test_a_submitted_team_still_cannot_read_the_answers(self):
        """Grading writes quiz_result onto the submission; it must not carry answers back."""
        self._submit({"response_payload": {"quiz": [{"id": "q1", "selectedOption": 0}]}})

        payload = self._get("/api/my-team/forms").json()

        self.assertEqual(self._keys_anywhere(payload) & self.ANSWER_KEYS, set())


class RandomQuizDrawTests(FormsApiTestBase):
    """`quiz.randomCount` serves a subset — the same subset to a whole team."""

    BANK_SIZE = 20
    DRAW_SIZE = 5

    def setUp(self):
        super().setUp()
        self.station.submission_config = {
            "items": [
                {"id": f"q{i}", "type": "quiz", "question": f"Cau {i}?",
                 "options": ["A", "B", "C"], "correctOption": i % 3, "points": 1}
                for i in range(self.BANK_SIZE)
            ],
            "quiz": {"randomCount": self.DRAW_SIZE},
        }
        self.station.save(update_fields=["submission_config"])

    def _set_random_count(self, count):
        self.station.submission_config = {
            **self.station.submission_config,
            "quiz": {**self.station.submission_config["quiz"], "randomCount": count},
        }
        self.station.save(update_fields=["submission_config"])

    def _served_ids(self, token=None):
        response = self.client.get(
            "/api/my-team/forms",
            HTTP_AUTHORIZATION=f"Bearer {token or self.token}",
        )
        self.assertEqual(response.status_code, 200)
        config = response.json()["accessible_forms"][0]["submission_config"]
        return [item["id"] for item in config["items"] if item["type"] == "quiz"]

    def _add_teammate(self, mssv="SV002"):
        """A second member of the *same* team, with their own session."""
        account = Account.objects.create(
            username=f"member-{mssv}",
            email=f"{mssv}@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv=mssv,
        )
        participant = Participant.objects.create(
            account=account, mssv=mssv, full_name=f"Member {mssv}",
            email=f"{mssv}@example.com",
        )
        TeamMembership.objects.create(team=self.team, participant=participant)
        return generate_session(account)

    def _answer(self, ids, correct=True):
        """Answer the given question ids, correctly or otherwise."""
        answers = []
        for item_id in ids:
            right = int(item_id[1:]) % 3
            answers.append({
                "id": item_id,
                "selectedOption": right if correct else (right + 1) % 3,
            })
        return answers

    def test_serves_only_the_configured_number_of_questions(self):
        served = self._served_ids()

        self.assertEqual(len(served), self.DRAW_SIZE)
        self.assertEqual(len(set(served)), self.DRAW_SIZE)

    def test_every_member_of_a_team_sees_the_same_questions(self):
        first = self._served_ids()
        teammate_token = self._add_teammate()

        self.assertEqual(self._served_ids(teammate_token), first)

    def test_reloading_never_reshuffles(self):
        first = self._served_ids()

        self.assertEqual(self._served_ids(), first)
        self.assertEqual(self._served_ids(), first)

    def test_served_questions_keep_the_bank_display_order(self):
        served = self._served_ids()

        self.assertEqual(served, sorted(served, key=lambda i: int(i[1:])))

    def test_answers_are_hidden_as_usual(self):
        response = self.client.get(
            "/api/my-team/forms",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        config = response.json()["accessible_forms"][0]["submission_config"]

        for item in config["items"]:
            self.assertNotIn("correctOption", item)

    def test_editing_a_question_does_not_redraw(self):
        served = self._served_ids()
        items = self.station.submission_config["items"]
        items[0] = {**items[0], "question": "Cau 0 (da sua chinh ta)?"}
        self.station.submission_config = {
            **self.station.submission_config, "items": items,
        }
        self.station.save(update_fields=["submission_config"])

        self.assertEqual(self._served_ids(), served)

    def test_deleting_a_served_question_backfills_and_keeps_the_rest(self):
        served = self._served_ids()
        dropped = served[0]
        self.station.submission_config = {
            **self.station.submission_config,
            "items": [
                item for item in self.station.submission_config["items"]
                if item["id"] != dropped
            ],
        }
        self.station.save(update_fields=["submission_config"])

        redrawn = self._served_ids()

        self.assertEqual(len(redrawn), self.DRAW_SIZE)
        self.assertNotIn(dropped, redrawn)
        self.assertTrue(set(served[1:]).issubset(redrawn))

    def test_lowering_the_count_trims_the_existing_draw(self):
        served = self._served_ids()
        self._set_random_count(3)

        trimmed = self._served_ids()

        self.assertEqual(len(trimmed), 3)
        self.assertTrue(set(trimmed).issubset(served))

    def test_zero_serves_the_whole_bank(self):
        self._set_random_count(0)

        self.assertEqual(len(self._served_ids()), self.BANK_SIZE)

    def test_a_count_above_the_bank_serves_the_whole_bank(self):
        self._set_random_count(self.BANK_SIZE + 5)

        self.assertEqual(len(self._served_ids()), self.BANK_SIZE)

    def test_turning_randomisation_off_and_on_restores_the_same_draw(self):
        served = self._served_ids()

        self._set_random_count(0)
        self.assertEqual(len(self._served_ids()), self.BANK_SIZE)

        self._set_random_count(self.DRAW_SIZE)
        self.assertEqual(self._served_ids(), served)

    def test_shrinking_the_bank_below_the_target_drops_the_draw(self):
        self._served_ids()
        self.station.submission_config = {
            **self.station.submission_config,
            "items": self.station.submission_config["items"][:3],
        }
        self.station.save(update_fields=["submission_config"])

        self.assertEqual(len(self._served_ids()), 3)
        self.assertFalse(
            TeamFormVariant.objects.filter(team=self.team, station=self.station).exists()
        )

    def test_grading_counts_only_the_served_questions(self):
        served = self._served_ids()

        response = self._submit({
            "response_payload": {"quiz": self._answer(served)},
        })

        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get(team=self.team, station=self.station)
        result = submission.response_payload["quiz_result"]
        self.assertEqual(result["total"], self.DRAW_SIZE)
        self.assertEqual(result["correct_count"], self.DRAW_SIZE)
        self.assertTrue(result["all_correct"])
        self.assertIs(submission.is_correct, True)

    def test_answers_outside_the_draw_are_ignored(self):
        served = set(self._served_ids())
        every_id = [f"q{i}" for i in range(self.BANK_SIZE)]
        # Correct on the drawn questions, wrong on all the others.
        answers = self._answer([i for i in every_id if i in served])
        answers += self._answer([i for i in every_id if i not in served], correct=False)

        response = self._submit({"response_payload": {"quiz": answers}})

        self.assertEqual(response.status_code, 201)
        submission = StationSubmission.objects.get(team=self.team, station=self.station)
        result = submission.response_payload["quiz_result"]
        self.assertEqual(result["total"], self.DRAW_SIZE)
        self.assertTrue(result["all_correct"])

    def test_each_team_draws_independently(self):
        self._served_ids()
        other = self._make_other_team()

        variant_service.variant_item_ids(self.station, other)

        self.assertEqual(
            TeamFormVariant.objects.filter(station=self.station).count(), 2,
        )
        for variant in TeamFormVariant.objects.filter(station=self.station):
            self.assertEqual(len(variant.item_ids), self.DRAW_SIZE)
