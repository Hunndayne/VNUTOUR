"""Run with --ds=serverapi.settings_test_postgres to exercise real row locks."""
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.db import close_old_connections
from django.test import Client, TransactionTestCase, skipUnlessDBFeature
from django.utils import timezone

from api.models import Account, PhaseRoster, ProgramPhase, Station, StationSession, SubEvent, Team
from api.services.auth_service import generate_session


@skipUnlessDBFeature('has_select_for_update')
class ReplayConcurrencyTests(TransactionTestCase):
    def test_two_scanners_cannot_spend_the_last_attempt_twice(self):
        phase = ProgramPhase.objects.create(key='qualifying', label='Qualifying', is_current=True)
        event = SubEvent.objects.create(phase=phase, name='Race', uses_stations=True)
        station = Station.objects.create(sub_event=event, code='A', name='A',
            scoring_mode='threshold', pass_threshold=10, max_attempts=3)
        team = Team.objects.create(code='RACE', name='Race', approval_status='approved', qr_token='race-token')
        PhaseRoster.objects.create(phase=phase, team=team)
        account = Account.objects.create(username='race-coop', role='collab')
        token = generate_session(account)
        for _ in range(2):
            StationSession.objects.create(team=team, station=station, sub_event=event, phase=phase,
                status='closed', outcome='failed', score=1, entered_at=timezone.now())
        barrier = Barrier(2)
        body = {'code':team.code, 'stationId':station.id, 'phaseKey':phase.key, 'eventId':event.id}

        def enter():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                response = Client().post('/api/station-sessions/enter', data=json.dumps(body),
                    content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {token}')
                return response.status_code, response.json()
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: enter(), range(2)))
        self.assertEqual(sorted(status for status, _ in results), [201, 409], results)
        self.assertEqual(StationSession.objects.filter(team=team, station=station).count(), 3)
        StationSession.objects.filter(team=team, status='active').update(status='closed', outcome='failed')
        response = Client().post('/api/station-sessions/enter', data=json.dumps(body),
            content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'replay_locked_attempts_exhausted')
