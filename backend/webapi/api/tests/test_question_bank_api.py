import json

from django.test import TestCase

from api.models import Account, ProgramPhase, QuestionBankItem, SubEvent
from api.services.auth_service import generate_session


class QuestionBankApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin1",
            email="admin1@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.token = generate_session(self.admin)
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=1, is_current=True,
        )
        self.event = SubEvent.objects.create(
            phase=self.phase, name="Station Run",
            type=SubEvent.TYPE_STATION_RUN, uses_stations=True, order=1,
        )
        self.item = QuestionBankItem.objects.create(
            sub_event=self.event, question="Q1", options=["A", "B", "C"], correct_option=0,
        )

    def _auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def test_update_question(self):
        resp = self.client.put(
            f"/api/program/sub-events/{self.event.id}/question-bank/{self.item.id}",
            data=json.dumps({"question": "Q1 updated", "correctOption": 1, "points": 2}),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["question"], "Q1 updated")
        self.assertEqual(body["correctOption"], 1)
        self.assertEqual(body["points"], 2)

        self.item.refresh_from_db()
        self.assertEqual(self.item.question, "Q1 updated")
        self.assertEqual(self.item.correct_option, 1)

    def test_update_question_rejects_out_of_range_correct_option(self):
        resp = self.client.put(
            f"/api/program/sub-events/{self.event.id}/question-bank/{self.item.id}",
            data=json.dumps({"correctOption": 5}),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(resp.status_code, 400)

    def test_update_question_active_toggle(self):
        resp = self.client.put(
            f"/api/program/sub-events/{self.event.id}/question-bank/{self.item.id}",
            data=json.dumps({"active": False}),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.item.refresh_from_db()
        self.assertFalse(self.item.active)

    def test_delete_question(self):
        resp = self.client.delete(
            f"/api/program/sub-events/{self.event.id}/question-bank/{self.item.id}",
            **self._auth(),
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(QuestionBankItem.objects.filter(id=self.item.id).exists())

    def test_update_question_wrong_sub_event_is_404(self):
        other_phase = ProgramPhase.objects.create(key="other", label="Other", order=2)
        other_event = SubEvent.objects.create(
            phase=other_phase, name="Other Event",
            type=SubEvent.TYPE_STATION_RUN, uses_stations=True, order=1,
        )
        resp = self.client.put(
            f"/api/program/sub-events/{other_event.id}/question-bank/{self.item.id}",
            data=json.dumps({"question": "hack"}),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(resp.status_code, 404)

    def test_requires_admin_role(self):
        participant = Account.objects.create(
            username="p1", email="p1@example.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT,
        )
        token = generate_session(participant)
        resp = self.client.delete(
            f"/api/program/sub-events/{self.event.id}/question-bank/{self.item.id}",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(resp.status_code, 403)
