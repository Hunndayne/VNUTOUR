import json

from django.test import TestCase

from api.models import (
    Account, Team, ProgramPhase, SubEvent, PhaseRoster, ScoreEntry, SystemSetting,
)
from api.services.auth_service import generate_session


class ScoreApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin", email="admin@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.collab = Account.objects.create(
            username="coop1", email="coop1@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Qualifying", order=1, is_current=True,
        )
        self.event = SubEvent.objects.create(
            phase=self.phase, name="Quiz", type=SubEvent.TYPE_QUIZ, order=1,
        )
        self.team1 = Team.objects.create(
            code="T0001", name="Team A", approval_status=Team.APPROVAL_APPROVED, qr_token="t1",
        )
        self.team2 = Team.objects.create(
            code="T0002", name="Team B", approval_status=Team.APPROVAL_APPROVED, qr_token="t2",
        )
        self.team_unrostered = Team.objects.create(
            code="T0003", name="Team C", approval_status=Team.APPROVAL_APPROVED, qr_token="t3",
        )
        for team in (self.team1, self.team2):
            PhaseRoster.objects.create(phase=self.phase, team=team, origin=PhaseRoster.ORIGIN_APPROVED)

    def _create_entry(self, account, team_code, points, kind="manual"):
        token = generate_session(account)
        return self.client.post(
            "/api/scores/entries",
            data=json.dumps({
                "phaseKey": self.phase.key, "eventId": self.event.id,
                "teamCode": team_code, "kind": kind, "points": points,
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def _scoreboard(self, account):
        token = generate_session(account)
        return self.client.get(
            f"/api/scores/phases/{self.phase.key}",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def test_admin_create_entry_appears_in_scoreboard(self):
        resp = self._create_entry(self.admin, self.team1.code, 10)
        self.assertEqual(resp.status_code, 201)
        board = self._scoreboard(self.admin).json()
        totals = {row["team_code"]: row["total_points"] for row in board["leaderboard"]}
        self.assertEqual(totals[self.team1.code], 10)

    def test_leaderboard_sorted_desc(self):
        self._create_entry(self.admin, self.team1.code, 10)
        self._create_entry(self.admin, self.team2.code, 25)
        board = self._scoreboard(self.admin).json()
        self.assertEqual(board["leaderboard"][0]["team_code"], self.team2.code)

    def test_update_and_delete_entry(self):
        created = self._create_entry(self.admin, self.team1.code, 10).json()
        admin_token = generate_session(self.admin)

        patched = self.client.patch(
            f"/api/scores/entries/{created['id']}",
            data=json.dumps({"points": 30}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(ScoreEntry.objects.get(id=created["id"]).points, 30)

        deleted = self.client.delete(
            f"/api/scores/entries/{created['id']}",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(ScoreEntry.objects.filter(id=created["id"]).exists())

    def test_invalid_kind_rejected(self):
        resp = self._create_entry(self.admin, self.team1.code, 10, kind="station")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"], "invalid_kind")

    def test_team_not_in_phase_rejected(self):
        resp = self._create_entry(self.admin, self.team_unrostered.code, 10)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "team_not_in_phase")

    def test_collab_forbidden_without_setting(self):
        resp = self._create_entry(self.collab, self.team1.code, 10)
        self.assertEqual(resp.status_code, 403)

    def test_collab_allowed_with_setting(self):
        SystemSetting.objects.create(key="collab_can_edit_scores", value=True)
        resp = self._create_entry(self.collab, self.team1.code, 10)
        self.assertEqual(resp.status_code, 201)
