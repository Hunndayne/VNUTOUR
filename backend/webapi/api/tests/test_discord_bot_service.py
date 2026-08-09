from pathlib import Path

from django.test import TestCase

from api.models import Account, DiscordBroadcast, Participant, Team, TeamMembership
from api.services.auth_service import generate_session
from api.services.discord_service import (
    claim_discord_identity,
    claim_next_broadcast,
    get_bot_runtime_status,
    get_pending_team_payloads,
    mark_broadcast_sent,
    record_bot_heartbeat,
    sync_member,
)


class DiscordBotPostgresServiceTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash="unused",
            role=Account.ROLE_ADMIN,
        )
        self.team = Team.objects.create(
            code="T0001",
            name="Postgres Team",
            approval_status=Team.APPROVAL_APPROVED,
            provision_state=Team.PROVISION_NONE,
            text_channel_id=101,
        )
        self.participant = Participant.objects.create(
            mssv="22520001",
            full_name="Nguyen Van A",
        )
        TeamMembership.objects.create(
            team=self.team,
            participant=self.participant,
            is_captain=True,
        )

    def test_claim_discord_identity_uses_participant_table_and_rejects_conflicts(self):
        linked = claim_discord_identity("22520001", 9001)

        self.assertEqual(linked["status"], "linked")
        self.participant.refresh_from_db()
        self.team.refresh_from_db()
        self.assertEqual(self.participant.discord_id, 9001)
        self.assertEqual(self.team.provision_state, Team.PROVISION_PENDING)

        other = Participant.objects.create(
            mssv="22520002",
            full_name="Tran Van B",
        )
        conflict = claim_discord_identity(other.mssv, 9001)
        self.assertEqual(conflict["status"], "discord_already_linked")
        other.refresh_from_db()
        self.assertIsNone(other.discord_id)

    def test_member_sync_from_web_queues_the_members_team(self):
        participant, error = sync_member(self.participant.mssv)

        self.assertIsNone(error)
        self.assertEqual(participant, self.participant)
        self.team.refresh_from_db()
        self.assertEqual(self.team.provision_state, Team.PROVISION_PENDING)

    def test_pending_payload_is_read_from_postgresql_relations(self):
        self.participant.discord_id = 9001
        self.participant.save(update_fields=["discord_id", "updated_at"])
        self.team.provision_state = Team.PROVISION_PENDING
        self.team.save(update_fields=["provision_state", "updated_at"])

        payloads = get_pending_team_payloads()

        self.assertEqual(len(payloads), 1)
        self.assertEqual(payloads[0]["code"], self.team.code)
        self.assertEqual(payloads[0]["members"], [{
            "mssv": self.participant.mssv,
            "full_name": self.participant.full_name,
            "discord_id": 9001,
        }])

    def test_broadcast_claim_resolves_channels_and_transitions_to_sent(self):
        broadcast = DiscordBroadcast.objects.create(
            title="Event update",
            message="Meet at 08:00",
            target=DiscordBroadcast.TARGET_APPROVED,
            sent_by=self.account,
        )

        claimed = claim_next_broadcast()

        self.assertEqual(claimed["id"], broadcast.id)
        self.assertEqual(claimed["channel_ids"], [101])
        broadcast.refresh_from_db()
        self.assertEqual(broadcast.status, DiscordBroadcast.STATUS_SENDING)
        self.assertIsNone(claim_next_broadcast())

        mark_broadcast_sent(broadcast.id)
        broadcast.refresh_from_db()
        self.assertEqual(broadcast.status, DiscordBroadcast.STATUS_SENT)
        self.assertIsNotNone(broadcast.sent_at)

    def test_bot_heartbeat_is_visible_to_the_web_status_endpoint(self):
        record_bot_heartbeat("VNUTour#0001", [123], 42.5)

        status = get_bot_runtime_status()

        self.assertTrue(status["online"])
        self.assertEqual(status["user"], "VNUTour#0001")
        self.assertEqual(status["guild_ids"], [123])
        self.assertEqual(status["latency_ms"], 42.5)

        response = self.client.get(
            "/api/discord/status",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(self.account)}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["bot"]["online"])

    def test_broadcast_api_rejects_unknown_target_instead_of_sending_to_every_team(self):
        response = self.client.post(
            "/api/discord/broadcasts",
            data={"title": "Unsafe", "message": "Do not send", "target": "typo"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(self.account)}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_target")
        self.assertFalse(DiscordBroadcast.objects.exists())


class DiscordBotLegacyDependencyGuardTests(TestCase):
    def test_bot_runtime_has_no_mongo_or_google_sheet_dependency(self):
        backend_root = Path(__file__).resolve().parents[3]
        source_root = backend_root / "src"
        forbidden = ("pymongo", "gspread", "MongoManager", "bot.mongo", "GoogleSheet")
        violations = []

        for path in source_root.rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            for token in forbidden:
                if token in text:
                    violations.append(f"{path.relative_to(backend_root)}: {token}")

        self.assertEqual(violations, [])
