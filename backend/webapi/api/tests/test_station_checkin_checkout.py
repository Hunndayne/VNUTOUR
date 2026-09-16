"""Thể lệ vòng loại 2026: check-in/checkout stations, replay after pass, second timers."""
import datetime
import json

from django.utils import timezone

from api.models import EventCheckIn, Station, StationSession
from api.services.auth_service import generate_session
from api.services.checkin_service import checkout_event, list_checkouts
from api.services.station_service import get_event_replay_state
from api.services.submission_config_service import normalize_config
from api.tests.test_station_journey_replay import StationJourneyTestBase


class CheckinCheckoutStationTests(StationJourneyTestBase):
    def setUp(self):
        super().setUp()
        self.play = Station.objects.create(sub_event=self.event, code='A', name='A',
            scoring_mode=Station.SCORING_THRESHOLD, pass_threshold=10, max_attempts=3)
        self.checkin_station = Station.objects.create(sub_event=self.event, code='IN', name='Check-in',
            kind=Station.KIND_CHECKIN)
        self.checkout_station = Station.objects.create(sub_event=self.event, code='OUT', name='Checkout',
            kind=Station.KIND_CHECKOUT)

    def _check_in(self):
        return EventCheckIn.objects.create(phase=self.phase, sub_event=self.event, team=self.team,
            scanner=self.collab, status=EventCheckIn.STATUS_ACTIVE)

    def test_gate_stations_are_not_part_of_the_journey(self):
        state = get_event_replay_state(self.team, self.event)
        self.assertEqual(set(state['by_station']), {self.play.id})
        self.assertEqual(state['total_stations'], 1)

    def test_gate_station_cannot_be_entered_as_play(self):
        response = self._enter(self.checkout_station)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'station_not_playable')

    def test_require_checkin_blocks_entry_until_checked_in(self):
        self.event.require_checkin = True
        self.event.save()
        response = self._enter(self.play)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'event_not_checked_in')
        self._check_in()
        self.assertEqual(self._enter(self.play).status_code, 201)

    def test_checkin_optional_by_default(self):
        self.assertEqual(self._enter(self.play).status_code, 201)

    def test_checkout_records_time_and_locks_further_play(self):
        self._play(self.play, 1)
        checkin, err = checkout_event(self.team.code, self.checkout_station, self.collab)
        self.assertIsNone(err)
        self.assertIsNotNone(checkin.checked_out_at)
        self.assertEqual(checkin.checkout_station_id, self.checkout_station.id)
        response = self._enter(self.play)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'team_checked_out')
        _, err = checkout_event(self.team.code, self.checkout_station, self.collab)
        self.assertEqual(err, 'already_checked_out')

    def test_checkout_does_not_require_checkin_when_event_requires_it(self):
        self.event.require_checkin = True
        self.event.save()
        checkin, err = checkout_event(self.team.code, self.checkout_station, self.collab)
        self.assertIsNone(err)
        self.assertIsNotNone(checkin.checked_out_at)

    def test_cannot_checkout_while_playing(self):
        self.assertEqual(self._enter(self.play).status_code, 201)
        _, err = checkout_event(self.team.code, self.checkout_station, self.collab)
        self.assertEqual(err, 'session_already_active')

    def test_checkout_list_orders_by_time_with_tiebreak_stats(self):
        from api.models import PhaseRoster, Team
        other = Team.objects.create(code='T0002', name='Team B',
            approval_status=Team.APPROVAL_APPROVED, qr_token='tok2')
        PhaseRoster.objects.create(phase=self.phase, team=other, origin=PhaseRoster.ORIGIN_APPROVED)
        self._play(self.play, 1)
        self._play(self.play, 10)
        checkout_event(self.team.code, self.checkout_station, self.collab)
        checkout_event(other.code, self.checkout_station, self.collab)
        rows = list_checkouts(self.event.id)
        self.assertEqual([row['team_code'] for row in rows], ['T0001', 'T0002'])
        self.assertEqual(rows[0]['passed_count'], 1)
        self.assertEqual(rows[0]['total_attempts'], 2)
        self.assertEqual(rows[1]['total_attempts'], 0)

        token = generate_session(self.admin)
        response = self.client.get(f'/api/event-checkins/checkouts?event_id={self.event.id}',
            HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['checkouts']), 2)

    def test_admin_can_undo_checkout(self):
        checkin, _ = checkout_event(self.team.code, self.checkout_station, self.collab)
        token = generate_session(self.admin)
        response = self.client.delete(f'/api/event-checkins/{checkin.id}?scope=checkout',
            HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 200)
        checkin.refresh_from_db()
        self.assertIsNone(checkin.checked_out_at)
        self.assertEqual(checkin.status, EventCheckIn.STATUS_ACTIVE)
        self.assertEqual(self._enter(self.play).status_code, 201)


class ReplayAfterPassTests(StationJourneyTestBase):
    def setUp(self):
        super().setUp()
        self.station = Station.objects.create(sub_event=self.event, code='A', name='A',
            scoring_mode=Station.SCORING_THRESHOLD, pass_threshold=10, max_attempts=3)

    def test_switch_off_keeps_pass_lock(self):
        self._play(self.station, 12)
        self.assertEqual(self._enter(self.station).json()['error'], 'replay_locked_passed')

    def test_switch_on_allows_remaining_attempts_and_keeps_best_score(self):
        self.event.replay_after_pass = True
        self.event.save()
        self._play(self.station, 12)
        self._play(self.station, 1)
        self._play(self.station, 11)
        response = self._enter(self.station)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'replay_locked_attempts_exhausted')
        entries = self._station_score_entries(self.station)
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().points, 12)


class DurationSecondsTests(StationJourneyTestBase):
    def test_minutes_only_config_still_reads_as_seconds(self):
        limits = normalize_config({'limits': {'durationMinutes': 2}})['limits']
        self.assertEqual(limits['durationSeconds'], 120)
        self.assertEqual(limits['durationMinutes'], 2)

    def test_seconds_config_wins(self):
        limits = normalize_config({'limits': {'durationSeconds': 50, 'durationMinutes': 5}})['limits']
        self.assertEqual(limits['durationSeconds'], 50)

    def test_fifty_second_window_closes_after_short_grace(self):
        from api.views_participant import _form_closure_state
        station = Station.objects.create(sub_event=self.event, code='T', name='Timed',
            submission_config={'items': [{'type': 'text', 'id': 'q', 'label': 'Q'}],
                               'limits': {'durationSeconds': 50}})
        session = StationSession.objects.create(team=self.team, station=station, sub_event=self.event,
            phase=self.phase, status=StationSession.STATUS_ACTIVE, entered_at=timezone.now())
        state = _form_closure_state(station, self.team)
        self.assertFalse(state['closed'])
        self.assertEqual(state['duration_seconds'], 50)
        session.entered_at = timezone.now() - datetime.timedelta(seconds=56)
        session.save()
        self.assertEqual(_form_closure_state(station, self.team)['reason'], 'time_closed')
