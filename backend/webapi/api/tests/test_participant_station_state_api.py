"""The endpoint the QR screen polls every couple of seconds.

Its whole job is to answer "has a coop scanned us yet?" cheaply enough to ask
often. The query-count test is the point of the endpoint, not a nicety: if it
ever grows to the cost of the station list, polling stops being the cheap option
and the design argument behind it falls over.
"""

from django.test import TestCase

from api.models import (
    Account, Participant, PhaseRoster, ProgramPhase, Station, StationSession,
    StationSubmission, SubEvent, SystemSetting, Team, TeamMembership,
)
from api.services.auth_service import generate_session

# What one poll costs, itemised so an accidental extra query is obvious:
#   1 auth token → account          5 SystemSetting current_sub_event_id ┐
#   2 membership + team             6 SubEvent (+phase select_related)    ├ QR
#   3 latest StationSession         7 Station EXISTS (live in event)      │ visibility
#   4 latest StationSubmission      8 PhaseRoster EXISTS (team eligible)  ┘
# Four of the eight decide whether the per-station QR is live: there is no global
# BTC toggle any more, so visibility is "a sub-event is running and this team is
# eligible for this live station" — settled here in one roster query.
EXPECTED_POLL_QUERIES = 8


class StationStateTestBase(TestCase):
    def setUp(self):
        self.account = Account.objects.create(
            username="thisinh", email="thisinh@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV001",
        )
        self.participant = Participant.objects.create(
            account=self.account, mssv="SV001", full_name="Thi Sinh",
            email="thisinh@example.com",
        )
        self.team = Team.objects.create(
            code="T0001", name="Doi A",
            approval_status=Team.APPROVAL_APPROVED, qr_token="tok-1",
        )
        TeamMembership.objects.create(
            team=self.team, participant=self.participant, is_captain=True,
        )
        self.phase = ProgramPhase.objects.create(
            key="qualifying", label="Vong loai", order=2, is_current=True,
        )
        PhaseRoster.objects.create(phase=self.phase, team=self.team)
        self.event = SubEvent.objects.create(phase=self.phase, name="Chay tram")
        self.station = Station.objects.create(
            sub_event=self.event, code="S01", name="Tram 1", order=1,
        )
        self.other_station = Station.objects.create(
            sub_event=self.event, code="S02", name="Tram 2", order=2,
        )
        SystemSetting.objects.update_or_create(
            key="current_sub_event_id", defaults={"value": str(self.event.id)},
        )
        SystemSetting.objects.update_or_create(
            key="checkin_qr",
            defaults={"value": {"enabled": True, "phase_key": self.phase.key}},
        )
        self.token = generate_session(self.account)

    def _get(self, station=None, expect=200):
        url = "/api/my-team/station-state"
        if station is not None:
            url += f"?station_id={station.id}"
        response = self.client.get(url, HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(response.status_code, expect)
        return response.json()

    def _enter(self, station):
        from django.utils import timezone
        return StationSession.objects.create(
            phase=self.phase, sub_event=self.event, station=station, team=self.team,
            status=StationSession.STATUS_ACTIVE, entered_at=timezone.now(),
        )


class StationStatePayloadTests(StationStateTestBase):
    def test_before_any_scan_the_qr_is_a_check_in_code_for_this_station(self):
        payload = self._get(self.station)

        self.assertIsNone(payload["session"])
        self.assertIsNone(payload["submission"])
        self.assertTrue(payload["qr"]["enabled"])
        # Standing outside the station, so it is the check-in code — and it
        # names the station, so the coop scanning it chooses neither.
        self.assertEqual(payload["qr"]["payload"], f"t:tok-1|s:{self.station.id}|d:in")
        self.assertEqual(payload["qr"]["direction"], "in")

    def test_once_inside_the_qr_becomes_a_check_out_code(self):
        """Same team, same station, but now active — a different code, not a relabel."""
        self._enter(self.station)

        payload = self._get(self.station)

        self.assertEqual(payload["qr"]["payload"], f"t:tok-1|s:{self.station.id}|d:out")
        self.assertEqual(payload["qr"]["direction"], "out")

    def test_the_stationless_poll_keeps_a_bare_event_token(self):
        """The list/gate screen names no station, so its QR carries no station either."""
        payload = self._get()

        self.assertEqual(payload["qr"]["payload"], "t:tok-1")
        self.assertIsNone(payload["qr"]["direction"])

    def test_a_scan_shows_up_as_an_active_session(self):
        """This transition is exactly what the screen is polling for."""
        self._enter(self.station)

        payload = self._get(self.station)

        self.assertEqual(payload["session"]["status"], "active")
        self.assertEqual(payload["session"]["station_id"], self.station.id)
        self.assertIsNotNone(payload["session"]["entered_at"])

    def test_leaving_shows_up_as_a_closed_session(self):
        from django.utils import timezone
        session = self._enter(self.station)
        session.status = StationSession.STATUS_CLOSED
        session.exited_at = timezone.now()
        session.save(update_fields=["status", "exited_at"])

        payload = self._get(self.station)

        self.assertEqual(payload["session"]["status"], "closed")
        self.assertIsNotNone(payload["session"]["exited_at"])

    def test_another_station_does_not_leak_in(self):
        self._enter(self.other_station)

        self.assertIsNone(self._get(self.station)["session"])

    def test_without_a_station_it_reports_where_the_team_currently_is(self):
        """Lets the list screen send a team straight back to the station they are in."""
        self._enter(self.other_station)

        payload = self._get()

        self.assertEqual(payload["session"]["station_id"], self.other_station.id)

    def test_without_a_station_a_finished_visit_is_not_reported(self):
        session = self._enter(self.other_station)
        session.status = StationSession.STATUS_CLOSED
        session.save(update_fields=["status"])

        self.assertIsNone(self._get()["session"])

    def test_a_submission_is_reported(self):
        StationSubmission.objects.create(
            team=self.team, station=self.station,
            status=StationSubmission.STATUS_SUBMITTED,
        )

        payload = self._get(self.station)

        self.assertEqual(payload["submission"]["status"], "submitted")

    def test_the_qr_reflects_a_rotated_token(self):
        """The QR rotates on every scan, so a stale payload here would be a dead code."""
        self.team.qr_token = "tok-2"
        self.team.save(update_fields=["qr_token"])

        self.assertEqual(
            self._get(self.station)["qr"]["payload"], f"t:tok-2|s:{self.station.id}|d:in",
        )

    def test_the_qr_is_live_without_any_global_check_in_toggle(self):
        """The per-station model has no BTC master switch: a running sub-event and
        an eligible team are enough, even with the legacy `checkin_qr` flag off."""
        SystemSetting.objects.filter(key="checkin_qr").update(
            value={"enabled": False, "phase_key": self.phase.key},
        )

        payload = self._get(self.station)

        self.assertTrue(payload["qr"]["enabled"])
        self.assertEqual(payload["qr"]["payload"], f"t:tok-1|s:{self.station.id}|d:in")

    def test_the_qr_is_hidden_between_events(self):
        """No sub-event running means there is nothing to check into yet."""
        SystemSetting.objects.filter(key="current_sub_event_id").update(value="")

        payload = self._get(self.station)

        self.assertFalse(payload["qr"]["enabled"])
        self.assertNotIn("payload", payload["qr"])

    def test_the_qr_is_hidden_for_an_inactive_station(self):
        self.station.active = False
        self.station.save(update_fields=["active"])

        payload = self._get(self.station)

        self.assertFalse(payload["qr"]["enabled"])

    def test_the_qr_is_hidden_for_a_team_off_a_rostered_phase(self):
        # Keep the phase roster-gated (another team stays on it) but drop this team.
        other = Team.objects.create(code="T999", name="Doi khac")
        PhaseRoster.objects.create(phase=self.phase, team=other)
        PhaseRoster.objects.filter(phase=self.phase, team=self.team).delete()

        payload = self._get(self.station)

        self.assertFalse(payload["qr"]["enabled"])

    def test_an_unapproved_team_gets_no_qr_but_still_gets_its_state(self):
        self.team.approval_status = Team.APPROVAL_PENDING
        self.team.save(update_fields=["approval_status"])
        self._enter(self.station)

        payload = self._get(self.station)

        self.assertFalse(payload["qr"]["enabled"])
        self.assertEqual(payload["session"]["status"], "active")

    def test_a_junk_station_id_is_rejected(self):
        response = self.client.get(
            "/api/my-team/station-state?station_id=abc",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 400)

    def test_only_participants_may_poll(self):
        staff = Account.objects.create(
            username="coop", email="coop@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )

        response = self.client.get(
            "/api/my-team/station-state",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(staff)}",
        )

        self.assertEqual(response.status_code, 403)

    def test_a_participant_without_a_team_gets_404(self):
        TeamMembership.objects.filter(participant=self.participant).delete()

        self.client.get(
            "/api/my-team/station-state",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        response = self.client.get(
            "/api/my-team/station-state",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 404)


class StationStateCostTests(StationStateTestBase):
    """Polling every 2s is only defensible while this stays small."""

    def test_the_poll_stays_cheap(self):
        self._enter(self.station)
        # Warm anything lazily cached so the count reflects a steady-state poll.
        self._get(self.station)

        with self.assertNumQueries(EXPECTED_POLL_QUERIES):
            self.client.get(
                f"/api/my-team/station-state?station_id={self.station.id}",
                HTTP_AUTHORIZATION=f"Bearer {self.token}",
            )

    def test_the_cost_does_not_grow_with_the_number_of_stations(self):
        for index in range(3, 15):
            Station.objects.create(
                sub_event=self.event, code=f"S{index:02d}",
                name=f"Tram {index}", order=index,
            )
        self._get(self.station)

        with self.assertNumQueries(EXPECTED_POLL_QUERIES):
            self.client.get(
                f"/api/my-team/station-state?station_id={self.station.id}",
                HTTP_AUTHORIZATION=f"Bearer {self.token}",
            )


class RejectedTeamMayStillBeFixedTests(StationStateTestBase):
    """Rejecting a team is an admin asking for changes; the ask must be actionable.

    Team edits are otherwise a registration-phase activity, but the note arrives
    whenever an organiser writes it — including mid-event. If the gate stayed
    closed, the captain would read "thiếu ảnh chuyển khoản" with no way to act.
    """

    def setUp(self):
        super().setUp()
        # Registration is over. The gate reads this setting, not the phase, so
        # the test has to close it explicitly rather than lean on a default.
        SystemSetting.objects.update_or_create(
            key="registration_open", defaults={"value": False},
        )
        self.team.payment_proof = "https://example.com/bill.jpg"
        self.team.save(update_fields=["payment_proof"])

    def _patch_team(self, name):
        import json
        return self.client.patch(
            "/api/my-team",
            data=json.dumps({"team_name": name}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_an_approved_team_cannot_be_edited_after_registration(self):
        response = self._patch_team("Ten moi")

        # This module's helper answers 409, unlike the same-named one in
        # views_register.py which answers 403.
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "registration_closed")

    def test_a_rejected_team_can_be_edited_after_registration(self):
        """The motivating case: "thieu anh chuyen khoan", fixed mid-event.

        The name is resent unchanged — renaming has its own rule (full teams
        only), and what the captain actually needs to change here is the proof.
        """
        self.team.approval_status = Team.APPROVAL_REJECTED
        self.team.approval_note = "Thieu anh chuyen khoan"
        self.team.save(update_fields=["approval_status", "approval_note"])

        import json
        response = self.client.patch(
            "/api/my-team",
            data=json.dumps({
                "team_name": self.team.name,
                "payment_proof": "https://example.com/bill-moi.jpg",
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200)
        self.team.refresh_from_db()
        self.assertEqual(self.team.payment_proof, "https://example.com/bill-moi.jpg")

    def test_a_rejected_team_can_resubmit_after_fixing(self):
        """Editing without being able to resubmit would only be half a fix."""
        self.team.approval_status = Team.APPROVAL_REJECTED
        self.team.save(update_fields=["approval_status"])

        response = self.client.post(
            "/api/my-team/submit", HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        # Whatever else the submit validates (profile completeness, roster size),
        # the closed registration phase must no longer be what stops it.
        self.assertNotEqual(response.json().get("error"), "registration_closed")

    def test_creating_a_new_team_stays_shut(self):
        """The exception is for fixing an existing team, not joining late."""
        import json
        loner = Account.objects.create(
            username="muon", email="muon@example.com",
            password_hash="x", role=Account.ROLE_PARTICIPANT, mssv="SV900",
        )
        Participant.objects.create(
            account=loner, mssv="SV900", full_name="Den Muon",
            email="muon@example.com",
        )

        response = self.client.post(
            "/api/my-team",
            data=json.dumps({}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {generate_session(loner)}",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "registration_closed")
