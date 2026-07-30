import json

from django.test import TestCase

from api.models import (
    Account,
    AuditLog,
    PhaseRoster,
    ProgramPhase,
    ScoreEntry,
    SubEvent,
    Team,
)
from api.services.auth_service import generate_session


class AuditUndoApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying",
            label="Qualifying",
            order=1,
            is_current=True,
        )
        self.final = ProgramPhase.objects.create(
            key="final",
            label="Final",
            order=2,
        )
        self.event = SubEvent.objects.create(
            phase=self.phase,
            name="Scoring",
        )
        self.team = Team.objects.create(
            code="T0001",
            name="Team A",
            approval_status=Team.APPROVAL_APPROVED,
        )
        PhaseRoster.objects.create(phase=self.phase, team=self.team)
        self.token = generate_session(self.admin)

    def _auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def test_score_create_is_audited_and_can_be_undone(self):
        response = self.client.post(
            "/api/scores/entries",
            data=json.dumps({
                "phaseKey": self.phase.key,
                "eventId": self.event.id,
                "teamCode": self.team.code,
                "kind": "bonus",
                "points": 25,
            }),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(response.status_code, 201)
        entry_id = response.json()["id"]
        log = AuditLog.objects.get(action="score.create")

        undo = self.client.post(
            f"/api/admin/audit-logs/{log.id}/undo",
            **self._auth(),
        )
        self.assertEqual(undo.status_code, 200)
        self.assertFalse(ScoreEntry.objects.filter(id=entry_id).exists())
        log.refresh_from_db()
        self.assertIsNotNone(log.undone_at)
        self.assertTrue(AuditLog.objects.filter(
            action="audit.undo",
            metadata__source_audit_id=log.id,
        ).exists())

    def test_phase_change_can_be_undone_without_deleting_history(self):
        response = self.client.put(
            "/api/program/current-phase",
            data=json.dumps({"phase_key": self.final.key}),
            content_type="application/json",
            **self._auth(),
        )
        self.assertEqual(response.status_code, 200)
        log = AuditLog.objects.get(action="phase.change")

        undo = self.client.post(
            f"/api/admin/audit-logs/{log.id}/undo",
            **self._auth(),
        )
        self.assertEqual(undo.status_code, 200)
        self.phase.refresh_from_db()
        self.final.refresh_from_db()
        self.assertTrue(self.phase.is_current)
        self.assertFalse(self.final.is_current)
        self.assertTrue(SubEvent.objects.filter(id=self.event.id).exists())

    def test_undo_refuses_to_overwrite_a_later_change(self):
        create = self.client.post(
            "/api/scores/entries",
            data=json.dumps({
                "phaseKey": self.phase.key,
                "eventId": self.event.id,
                "teamCode": self.team.code,
                "kind": "manual",
                "points": 10,
            }),
            content_type="application/json",
            **self._auth(),
        )
        entry = ScoreEntry.objects.get(id=create.json()["id"])
        log = AuditLog.objects.get(action="score.create")
        entry.points = 99
        entry.save(update_fields=["points", "updated_at"])

        undo = self.client.post(
            f"/api/admin/audit-logs/{log.id}/undo",
            **self._auth(),
        )
        self.assertEqual(undo.status_code, 409)
        self.assertEqual(undo.json()["error"], "undo_conflict")
        entry.refresh_from_db()
        self.assertEqual(entry.points, 99)
