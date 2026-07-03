import json

from django.test import TestCase

from api.models import (
    Account, Team, ProgramPhase, SubEvent, PhaseRoster, ScoreEntry, AdvancementRule,
)
from api.services.auth_service import generate_session


class AdvancementApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin", email="admin@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.collab = Account.objects.create(
            username="coop1", email="coop1@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        self.qualifying = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=1, is_current=True,
        )
        self.final = ProgramPhase.objects.create(
            key="final", label="Final", order=2,
        )
        self.event = SubEvent.objects.create(
            phase=self.qualifying, name="Quiz", type=SubEvent.TYPE_QUIZ, order=1,
        )
        self.teams = {}
        for idx, points in [(1, 20), (2, 30), (3, 10)]:
            team = Team.objects.create(
                code=f"T000{idx}", name=f"Team {idx}",
                approval_status=Team.APPROVAL_APPROVED, qr_token=f"t{idx}",
            )
            PhaseRoster.objects.create(phase=self.qualifying, team=team, origin=PhaseRoster.ORIGIN_APPROVED)
            ScoreEntry.objects.create(
                phase=self.qualifying, sub_event=self.event, team=team,
                kind=ScoreEntry.KIND_MANUAL, points=points, created_by=self.admin,
            )
            self.teams[idx] = team

    def _set_rule(self, account, slots=2, mode="top_n"):
        token = generate_session(account)
        return self.client.put(
            "/api/scores/phases/qualifying/advancement",
            data=json.dumps({"toPhaseKey": "final", "mode": mode, "slots": slots}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def _publish(self, account, phase_key="qualifying"):
        token = generate_session(account)
        return self.client.post(
            f"/api/scores/phases/{phase_key}/publish-advancement",
            data=json.dumps({}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def test_set_rule(self):
        resp = self._set_rule(self.admin, slots=2)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["slots"], 2)
        self.assertTrue(AdvancementRule.objects.filter(
            from_phase=self.qualifying, to_phase=self.final,
        ).exists())

    def test_publish_promotes_top_n(self):
        self._set_rule(self.admin, slots=2)
        resp = self._publish(self.admin)
        self.assertEqual(resp.status_code, 200)

        promoted = set(PhaseRoster.objects.filter(
            phase=self.final, origin=PhaseRoster.ORIGIN_QUALIFIED,
        ).values_list("team__code", flat=True))
        self.assertEqual(promoted, {self.teams[2].code, self.teams[1].code})
        self.assertNotIn(self.teams[3].code, promoted)

    def test_republish_idempotent(self):
        self._set_rule(self.admin, slots=2)
        self._publish(self.admin)
        self._publish(self.admin)
        self.assertEqual(
            PhaseRoster.objects.filter(phase=self.final, origin=PhaseRoster.ORIGIN_QUALIFIED).count(),
            2,
        )

    def test_publish_without_rule_fails(self):
        resp = self._publish(self.admin, phase_key="final")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"], "advancement_rule_not_found")

    def test_collab_cannot_set_rule(self):
        resp = self._set_rule(self.collab)
        self.assertIn(resp.status_code, (401, 403))
