from django.test import TestCase

from api.models import (
    Account,
    AuditLog,
    CaptainVote,
    Participant,
    Team,
    TeamMembership,
)
from api.services.auth_service import generate_session


class AdminTeamEditApiTests(TestCase):
    """Organiser roster edits that must not force a merge-style rename/ballot."""

    def setUp(self):
        self.admin = Account.objects.create(
            username="admin_user", email="admin@example.com", password_hash="x",
            role=Account.ROLE_ADMIN, mssv="ADMIN01",
        )
        self.admin_token = generate_session(self.admin)
        self.collab = Account.objects.create(
            username="collab_user", email="collab@example.com", password_hash="x",
            role=Account.ROLE_COLLAB, mssv="COLLAB01",
        )
        self.collab_token = generate_session(self.collab)

    def _auth(self, token=None):
        return {"HTTP_AUTHORIZATION": f"Bearer {token or self.admin_token}"}

    def _team(self, code, name, members, status=Team.APPROVAL_APPROVED):
        """members: list of (mssv, is_captain)."""
        team = Team.objects.create(code=code, name=name, approval_status=status)
        for mssv, is_captain in members:
            participant, _ = Participant.objects.get_or_create(
                mssv=mssv,
                defaults={"full_name": f"Name {mssv}", "email": f"{mssv.lower()}@example.com"},
            )
            TeamMembership.objects.create(team=team, participant=participant, is_captain=is_captain)
        return team

    def _add(self, team, body, token=None):
        return self.client.post(
            f"/api/teams/{team.code}/members", body,
            content_type="application/json", **self._auth(token),
        )

    # ---- add member -------------------------------------------------------

    def test_add_existing_free_participant_keeps_name_and_captain(self):
        team = self._team("T3001", "Đội Giữ Tên", [("SV1001", True), ("SV1002", False)])
        Participant.objects.create(mssv="SV1003", full_name="Free P", email="free@example.com")

        resp = self._add(team, {"mssv": "sv1003"})
        self.assertEqual(resp.status_code, 201, resp.json())

        self.assertTrue(TeamMembership.objects.filter(team=team, participant__mssv="SV1003").exists())
        team.refresh_from_db()
        self.assertEqual(team.name, "Đội Giữ Tên")
        self.assertTrue(
            TeamMembership.objects.filter(team=team, participant__mssv="SV1001", is_captain=True).exists()
        )
        self.assertEqual(team.provision_state, Team.PROVISION_PENDING)
        self.assertTrue(AuditLog.objects.filter(action="team.member.add", target_id=str(team.id)).exists())

    def test_add_new_participant_requires_full_name(self):
        team = self._team("T3002", "Đội Mới", [("SV1101", True)])

        resp = self._add(team, {"mssv": "SV1102"})
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "participant_not_found")

        resp = self._add(team, {"mssv": "SV1102", "full_name": "Người Mới", "email": "moi@example.com"})
        self.assertEqual(resp.status_code, 201, resp.json())
        participant = Participant.objects.get(mssv="SV1102")
        self.assertEqual(participant.full_name, "Người Mới")
        self.assertEqual(participant.memberships.get().team_id, team.id)

    def test_add_member_from_other_team_requires_move(self):
        target = self._team("T3003", "Đích", [("SV1201", True)])
        source = self._team("T3004", "Nguồn", [("SV1202", True), ("SV1203", False)])

        resp = self._add(target, {"mssv": "SV1203"})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "mssv_in_other_team:T3004")
        self.assertEqual(resp.json()["source_team_code"], "T3004")
        self.assertTrue(TeamMembership.objects.filter(team=source, participant__mssv="SV1203").exists())

        resp = self._add(target, {"mssv": "SV1203", "move": True})
        self.assertEqual(resp.status_code, 201, resp.json())
        self.assertTrue(TeamMembership.objects.filter(team=target, participant__mssv="SV1203").exists())
        source.refresh_from_db()
        # A non-captain leaving does not reset the source team.
        self.assertEqual(source.name, "Nguồn")
        self.assertEqual(source.provision_state, Team.PROVISION_PENDING)

    def test_moving_source_captain_reopens_source_ballot_only(self):
        target = self._team("T3005", "Đích", [("SV1301", True)])
        source = self._team("T3006", "Nguồn Có Tên", [("SV1302", True), ("SV1303", False)])

        resp = self._add(target, {"mssv": "SV1302", "move": True})
        self.assertEqual(resp.status_code, 201, resp.json())

        moved = TeamMembership.objects.get(participant__mssv="SV1302")
        self.assertEqual(moved.team_id, target.id)
        self.assertFalse(moved.is_captain)
        target.refresh_from_db()
        self.assertEqual(target.name, "Đích")
        source.refresh_from_db()
        self.assertEqual(source.name, source.code)
        self.assertFalse(TeamMembership.objects.filter(team=source, is_captain=True).exists())

    def test_add_member_rejects_full_team_and_duplicate(self):
        team = self._team("T3007", "Đầy", [(f"SV14{i:02d}", i == 0) for i in range(5)])
        Participant.objects.create(mssv="SV1499", full_name="Extra", email="extra@example.com")

        resp = self._add(team, {"mssv": "SV1499"})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "team_full")

        resp = self._add(team, {"mssv": "SV1401"})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "already_in_team")

    def test_add_member_forbidden_for_collab(self):
        team = self._team("T3008", "Đội", [("SV1501", True)])
        Participant.objects.create(mssv="SV1502", full_name="P", email="p1502@example.com")
        resp = self._add(team, {"mssv": "SV1502"}, token=self.collab_token)
        self.assertEqual(resp.status_code, 403)

    def test_draft_team_does_not_touch_discord_queue(self):
        team = self._team("T3009", "Nháp", [("SV1601", True)], status=Team.APPROVAL_DRAFT)
        Participant.objects.create(mssv="SV1602", full_name="P", email="p1602@example.com")
        resp = self._add(team, {"mssv": "SV1602"})
        self.assertEqual(resp.status_code, 201, resp.json())
        team.refresh_from_db()
        self.assertEqual(team.provision_state, Team.PROVISION_NONE)

    # ---- captain ------------------------------------------------------------

    def test_patch_captain_appoints_without_ballot_or_rename(self):
        team = self._team("T3010", "Tên Đẹp", [("SV1701", False), ("SV1702", False)])
        voter = Participant.objects.get(mssv="SV1701")
        candidate = Participant.objects.get(mssv="SV1702")
        CaptainVote.objects.create(team=team, voter=voter, candidate=candidate)
        account = Account.objects.create(
            username="sv1702", email="sv1702@example.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="SV1702",
        )
        candidate.account = account
        candidate.save()

        resp = self.client.patch(
            f"/api/teams/{team.code}", {"captain_mssv": "SV1702"},
            content_type="application/json", **self._auth(),
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        team.refresh_from_db()
        self.assertEqual(team.name, "Tên Đẹp")
        self.assertEqual(team.owner_account_id, account.id)
        self.assertEqual(CaptainVote.objects.filter(team=team).count(), 0)
        self.assertEqual(
            list(TeamMembership.objects.filter(team=team, is_captain=True).values_list("participant__mssv", flat=True)),
            ["SV1702"],
        )

    def test_patch_captain_switches_from_existing_captain(self):
        team = self._team("T3011", "Đổi Trưởng", [("SV1801", True), ("SV1802", False)])
        resp = self.client.patch(
            f"/api/teams/{team.code}", {"captain_mssv": "SV1802"},
            content_type="application/json", **self._auth(),
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(
            list(TeamMembership.objects.filter(team=team, is_captain=True).values_list("participant__mssv", flat=True)),
            ["SV1802"],
        )

    def test_patch_captain_not_on_team(self):
        team = self._team("T3012", "Đội", [("SV1901", True)])
        resp = self.client.patch(
            f"/api/teams/{team.code}", {"captain_mssv": "SV9999"},
            content_type="application/json", **self._auth(),
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "captain_not_in_team")

    def test_patch_rename_is_audited_and_requeues_discord(self):
        team = self._team("T3013", "Tên Cũ", [("SV2001", True)])
        resp = self.client.patch(
            f"/api/teams/{team.code}", {"name": "Tên Mới"},
            content_type="application/json", **self._auth(),
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        team.refresh_from_db()
        self.assertEqual(team.name, "Tên Mới")
        self.assertEqual(team.provision_state, Team.PROVISION_PENDING)
        self.assertTrue(AuditLog.objects.filter(action="team.rename", target_id=str(team.id)).exists())

    # ---- remove captain with successor ------------------------------------------

    def test_remove_captain_with_successor_keeps_name(self):
        team = self._team("T3014", "Không Đổi", [("SV2101", True), ("SV2102", False), ("SV2103", False)])
        resp = self.client.delete(
            f"/api/teams/{team.code}/members/SV2101?new_captain=sv2103", **self._auth(),
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(resp.json()["new_captain_mssv"], "SV2103")
        team.refresh_from_db()
        self.assertEqual(team.name, "Không Đổi")
        self.assertEqual(
            list(TeamMembership.objects.filter(team=team, is_captain=True).values_list("participant__mssv", flat=True)),
            ["SV2103"],
        )
        self.assertEqual(team.provision_state, Team.PROVISION_PENDING)

    def test_remove_captain_with_invalid_successor_changes_nothing(self):
        team = self._team("T3015", "Giữ", [("SV2201", True), ("SV2202", False)])
        resp = self.client.delete(
            f"/api/teams/{team.code}/members/SV2201?new_captain=SV9999", **self._auth(),
        )
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "new_captain_not_in_team")
        self.assertTrue(
            TeamMembership.objects.filter(team=team, participant__mssv="SV2201", is_captain=True).exists()
        )
