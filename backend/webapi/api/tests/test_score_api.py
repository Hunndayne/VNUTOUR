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

    def _scoreboard(self, account, phase_key=None):
        token = generate_session(account)
        return self.client.get(
            f"/api/scores/phases/{phase_key or self.phase.key}",
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

    def test_score_entries_blocked_when_results_locked(self):
        entry = ScoreEntry.objects.create(
            phase=self.phase, sub_event=self.event, team=self.team1,
            kind=ScoreEntry.KIND_MANUAL, points=10, created_by=self.admin,
        )
        self.phase.is_current = False
        self.phase.save(update_fields=["is_current"])
        ProgramPhase.objects.create(key="ended", label="Ended", order=2, is_current=True)

        created = self._create_entry(self.admin, self.team1.code, 20)
        self.assertEqual(created.status_code, 409)
        self.assertEqual(created.json()["error"], "results_locked")

        admin_token = generate_session(self.admin)
        patched = self.client.patch(
            f"/api/scores/entries/{entry.id}",
            data=json.dumps({"points": 30}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )
        self.assertEqual(patched.status_code, 409)
        self.assertEqual(patched.json()["error"], "results_locked")
        entry.refresh_from_db()
        self.assertEqual(entry.points, 10)

        deleted = self.client.delete(
            f"/api/scores/entries/{entry.id}",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )
        self.assertEqual(deleted.status_code, 409)
        self.assertEqual(deleted.json()["error"], "results_locked")
        self.assertTrue(ScoreEntry.objects.filter(id=entry.id).exists())

    def test_ended_scoreboard_summarizes_final_phase_results(self):
        self.phase.is_current = False
        self.phase.save(update_fields=["is_current"])
        final = ProgramPhase.objects.create(key="final", label="Final", order=2)
        ended = ProgramPhase.objects.create(key="ended", label="Ended", order=3, is_current=True)
        final_event = SubEvent.objects.create(
            phase=final, name="Final Station Run",
            type=SubEvent.TYPE_STATION_RUN, uses_stations=True, order=1,
        )
        PhaseRoster.objects.create(
            phase=final, team=self.team1,
            origin=PhaseRoster.ORIGIN_QUALIFIED, qualified_from_phase=self.phase,
        )
        PhaseRoster.objects.create(
            phase=final, team=self.team2,
            origin=PhaseRoster.ORIGIN_QUALIFIED, qualified_from_phase=self.phase,
        )
        ScoreEntry.objects.create(
            phase=final, sub_event=final_event, team=self.team1,
            kind=ScoreEntry.KIND_STATION, points=42, created_by=self.admin,
        )
        ScoreEntry.objects.create(
            phase=final, sub_event=final_event, team=self.team2,
            kind=ScoreEntry.KIND_STATION, points=30, created_by=self.admin,
        )

        resp = self._scoreboard(self.admin, phase_key=ended.key)
        self.assertEqual(resp.status_code, 200)
        board = resp.json()
        self.assertEqual(board["phase_key"], "ended")
        self.assertEqual(board["source_phase_key"], "final")
        self.assertEqual(board["source_phase_label"], "Final")
        self.assertTrue(board["results_locked"])
        self.assertTrue(board["uses_phase_roster"])
        self.assertIsNone(board["advancement"]["next_phase_key"])

        codes = [row["team_code"] for row in board["leaderboard"]]
        self.assertEqual(codes, [self.team1.code, self.team2.code])
        self.assertNotIn(self.team_unrostered.code, codes)
        totals = {row["team_code"]: row["total_points"] for row in board["leaderboard"]}
        self.assertEqual(totals, {self.team1.code: 42, self.team2.code: 30})
        self.assertEqual(len(board["score_entries"]), 2)
        self.assertEqual(board["sub_events"][0]["name"], "Final Station Run")

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
