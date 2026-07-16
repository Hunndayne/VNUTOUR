import json

from django.db import IntegrityError, transaction
from django.test import TestCase

from api.models import (
    Account, Participant, Team, TeamMembership,
    ProgramPhase, SubEvent, PhaseRoster, EventCheckIn,
)
from api.services.auth_service import generate_session


class EventCheckinApiTests(TestCase):
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
            phase=self.phase, name="Cong su kien",
            type=SubEvent.TYPE_STATION_RUN, uses_stations=True, order=1,
        )
        self.team = Team.objects.create(
            code="T0001", name="Team A", approval_status=Team.APPROVAL_APPROVED, qr_token="t1",
        )
        self.team_unrostered = Team.objects.create(
            code="T0002", name="Team B", approval_status=Team.APPROVAL_APPROVED, qr_token="t2",
        )
        PhaseRoster.objects.create(phase=self.phase, team=self.team, origin=PhaseRoster.ORIGIN_APPROVED)
        participant = Participant.objects.create(mssv="SV001", full_name="A")
        TeamMembership.objects.create(team=self.team, participant=participant, is_captain=True)

    def _scan(self, account, code, with_event=True):
        token = generate_session(account)
        body = {"code": code, "phaseKey": self.phase.key}
        if with_event:
            body["eventId"] = self.event.id
        return self.client.post(
            "/api/event-checkins/scan",
            data=json.dumps(body),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def test_scan_success(self):
        resp = self._scan(self.collab, self.team.code)
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(EventCheckIn.objects.filter(
            sub_event=self.event, team=self.team, status=EventCheckIn.STATUS_ACTIVE,
        ).exists())

    def test_scan_already_checked_in(self):
        self._scan(self.collab, self.team.code)
        resp = self._scan(self.collab, self.team.code)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()["error"], "already_checked_in")
        self.assertEqual(EventCheckIn.objects.filter(
            sub_event=self.event,
            team=self.team,
            status=EventCheckIn.STATUS_ACTIVE,
        ).count(), 1)

    def test_database_rejects_two_active_checkins_for_same_team_and_event(self):
        EventCheckIn.objects.create(
            phase=self.phase,
            sub_event=self.event,
            team=self.team,
            scanner=self.collab,
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                EventCheckIn.objects.create(
                    phase=self.phase,
                    sub_event=self.event,
                    team=self.team,
                    scanner=self.collab,
                )

    def test_reset_preserves_history_and_allows_one_new_active_checkin(self):
        first_response = self._scan(self.collab, self.team.code)
        first = EventCheckIn.objects.get(id=first_response.json()["id"])
        admin_token = generate_session(self.admin)
        self.client.delete(
            f"/api/event-checkins/{first.id}",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )

        second_response = self._scan(self.collab, self.team.code)
        self.assertEqual(second_response.status_code, 201)
        self.assertEqual(EventCheckIn.objects.filter(
            sub_event=self.event,
            team=self.team,
            status=EventCheckIn.STATUS_ACTIVE,
        ).count(), 1)
        first.refresh_from_db()
        self.assertEqual(first.status, EventCheckIn.STATUS_REVERTED)

    def test_scan_team_not_found(self):
        resp = self._scan(self.collab, "NOPE")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "team_not_found")

    def test_scan_missing_event(self):
        resp = self._scan(self.collab, self.team.code, with_event=False)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["error"], "missing_phase_or_event")

    def test_scan_team_not_in_phase(self):
        resp = self._scan(self.collab, self.team_unrostered.code)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["error"], "team_not_in_phase")

    def test_stats_counts(self):
        self._scan(self.collab, self.team.code)
        token = generate_session(self.collab)
        resp = self.client.get(
            f"/api/event-checkins/stats?phase_key={self.phase.key}&event_id={self.event.id}",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["checked_in_teams"], 1)
        self.assertEqual(body["checked_in_participants"], 1)

    def test_reset_admin_only(self):
        self._scan(self.collab, self.team.code)
        checkin = EventCheckIn.objects.get(team=self.team)

        collab_token = generate_session(self.collab)
        forbidden = self.client.delete(
            f"/api/event-checkins/{checkin.id}",
            HTTP_AUTHORIZATION=f"Bearer {collab_token}",
        )
        self.assertIn(forbidden.status_code, (401, 403))

        admin_token = generate_session(self.admin)
        ok = self.client.delete(
            f"/api/event-checkins/{checkin.id}",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )
        self.assertEqual(ok.status_code, 200)
