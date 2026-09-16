"""Public API coverage for per-team total attempts and explicit free-play starts."""
import json
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from api.models import Account, ScoreEntry, Station, StationSession, StationSubmission, SystemSetting, TeamFormDraft
from api.services.auth_service import generate_session
from api.services.station_service import get_event_replay_state
from api.tests.test_station_journey_replay import StationJourneyTestBase
from api.tests.test_participant_forms_api import FormsApiTestBase


class ReplayLimitTests(StationJourneyTestBase):
    def setUp(self):
        super().setUp()
        self.station = Station.objects.create(sub_event=self.event, code='A', name='A',
            max_attempts=3, scoring_mode=Station.SCORING_THRESHOLD, pass_threshold=10)

    def state(self):
        return get_event_replay_state(self.team, self.event)['by_station'][self.station.id]

    def test_three_total_attempts_then_fourth_is_denied(self):
        for index in range(3):
            self.assertEqual(self._play(self.station, 1).status_code, 200)
            self.assertEqual(self.state()['attempts_used'], index + 1)
            self.assertEqual(self.state()['attempts_remaining'], 2 - index)
        result = self._enter(self.station)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result.json()['error'], 'replay_locked_attempts_exhausted')

    def test_pass_locks_even_with_switch_off_and_attempts_left(self):
        self._play(self.station, 10)
        self.assertEqual(self.state()['attempts_remaining'], 2)
        self.assertEqual(self._enter(self.station).json()['error'], 'replay_locked_passed')

    def test_failed_can_retry_immediately_when_switch_off(self):
        Station.objects.create(sub_event=self.event, code='B', name='B')
        self._play(self.station, 1)
        self.assertEqual(self._enter(self.station).status_code, 201)

    def test_mixed_free_play_journey_unlocks_scan_api(self):
        self.event.replay_after_all = True
        self.event.save()
        other = Station.objects.create(sub_event=self.event, code='B', name='B',
            checkin_policy='free_play', submission_config={'items': [{'type':'text', 'id':'q', 'label':'Q'}]})
        self._play(self.station, 1)
        self.assertEqual(self._enter(self.station).json()['error'], 'replay_locked_incomplete')
        legacy = StationSubmission.objects.create(team=self.team, station=other, status='draft')
        self.assertEqual(self.state()['replay_reason'], 'incomplete')
        legacy.status = 'submitted'
        legacy.save()
        self.assertTrue(get_event_replay_state(self.team, self.event)['all_visited'])
        self.assertEqual(self._enter(self.station).status_code, 201)

    def test_untracked_free_play_is_not_an_impossible_prerequisite(self):
        self.event.replay_after_all = True
        self.event.save()
        Station.objects.create(sub_event=self.event, code='B', name='Activity', checkin_policy='free_play')
        self._play(self.station, 1)
        self.assertEqual(self._enter(self.station).status_code, 201)

    def test_cancelled_pass_does_not_spend_or_lock_attempt(self):
        StationSession.objects.create(team=self.team, station=self.station, sub_event=self.event,
            phase=self.phase, status='cancelled', outcome='passed', entered_at=timezone.now())
        self.assertEqual(self.state()['attempts_used'], 0)
        self.assertEqual(self._enter(self.station).status_code, 201)

    def test_lowering_limit_keeps_active_attempt_finishable(self):
        self._play(self.station, 1)
        self.assertEqual(self._enter(self.station).status_code, 201)
        self.station.max_attempts = 1
        self.station.save()
        self.assertEqual(self._exit(self.station, score=1).status_code, 200)
        self.assertEqual(self.state()['attempts_remaining'], 0)
        self.assertEqual(self._enter(self.station).json()['error'], 'replay_locked_attempts_exhausted')

    def test_unlimited_failed_attempts_and_pending_results(self):
        self.station.max_attempts = None
        self.station.save()
        for _ in range(4):
            self._play(self.station, 1)
        self.assertIsNone(self.state()['attempts_remaining'])
        self.assertEqual(self._enter(self.station).status_code, 201)
        self._exit(self.station)  # no grade on this attempt
        self.assertEqual(self._enter(self.station).json()['error'], 'replay_locked_pending_result')

    def test_admin_config_round_trip_and_strict_validation(self):
        self.admin.role = Account.ROLE_MASTER_ADMIN
        self.admin.save()
        headers = {'HTTP_AUTHORIZATION': f'Bearer {generate_session(self.admin)}'}
        for value in (0, -1, 2.5, True, 'three', '2.5', 2**40):
            result = self.client.patch(f'/api/stations/{self.station.id}',
                data=json.dumps({'max_attempts':value}), content_type='application/json', **headers)
            self.assertEqual(result.status_code, 400, (value, result.content))
        for value in (1, 3, None):
            result = self.client.patch(f'/api/stations/{self.station.id}',
                data=json.dumps({'max_attempts':value}), content_type='application/json', **headers)
            self.assertEqual(result.status_code, 200, result.content)
            self.assertEqual(result.json()['max_attempts'], value)
        result = self.client.post(f'/api/sub-events/{self.event.id}/stations',
            data=json.dumps({'code':'NEW','name':'New','max_attempts':5}), content_type='application/json', **headers)
        self.assertEqual(result.status_code, 201, result.content)
        self.assertEqual(result.json()['max_attempts'], 5)

    def test_database_rejects_zero_limit(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Station.objects.filter(id=self.station.id).update(max_attempts=0)


class FreePlayReplayTests(FormsApiTestBase):
    def setUp(self):
        super().setUp()
        self.session.delete()
        self.station.checkin_policy = 'free_play'
        self.station.scoring_mode = 'pass_fail'
        self.station.pass_points = 7
        self.station.max_attempts = 3
        self.station.submission_config['quiz']['autoScore'] = True
        self.station.save()
        SystemSetting.objects.update_or_create(key='current_sub_event_id', defaults={'value':str(self.event.id)})

    def start(self):
        return self.client.post(f'/api/my-team/forms/{self.station.id}/start',
            HTTP_AUTHORIZATION=f'Bearer {self.token}')

    def answer(self, correct=False):
        return self._submit({'response_payload':{'quiz':[{'id':'q1','selectedOption':1 if correct else 0}]}})

    def detail(self):
        return self.client.get(f'/api/my-team/station-state?station_id={self.station.id}',
            HTTP_AUTHORIZATION=f'Bearer {self.token}').json()

    def test_direct_submit_requires_start_and_repeated_start_is_idempotent(self):
        self.assertEqual(self.answer().status_code, 409)
        self.assertEqual(StationSession.objects.count(), 0)
        self.assertEqual(self.start().status_code, 200)
        self.assertEqual(self.start().status_code, 200)
        self.assertEqual(StationSession.objects.count(), 1)

    def test_retries_have_distinct_submissions_and_lock_at_three(self):
        ids = []
        for _ in range(3):
            self.assertEqual(self.start().status_code, 200)
            result = self.answer()
            self.assertEqual(result.status_code, 201, result.content)
            ids.append(result.json()['id'])
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(self.detail()['attempts_used'], 3)
        self.assertEqual(self.start().json()['error'], 'replay_locked_attempts_exhausted')
        self.assertEqual(StationSubmission.objects.count(), 3)

    def test_correct_answer_locks_and_score_is_not_summed(self):
        self.start()
        self.answer()
        self.start()
        self.answer(True)
        self.assertEqual(self.start().json()['error'], 'replay_locked_passed')
        self.assertEqual(self.detail()['attempts_remaining'], 1)
        self.assertEqual(list(ScoreEntry.objects.values_list('points', flat=True)), [7])

    def test_poll_and_list_agree_after_manual_regrade(self):
        self.start()
        self.answer()
        submission = StationSubmission.objects.get()
        admin = Account.objects.create(username='regrade', role='admin')
        headers = {'HTTP_AUTHORIZATION':f'Bearer {generate_session(admin)}'}
        for correct, reason in ((True,'passed'), (False,None)):
            result = self.client.patch(f'/api/submissions/{submission.id}/grade',
                data=json.dumps({'is_correct':correct}), content_type='application/json', **headers)
            self.assertEqual(result.status_code, 200, result.content)
            detail = self.detail()
            listing = self.client.get('/api/my-team/stations', HTTP_AUTHORIZATION=f'Bearer {self.token}').json()['stations'][0]
            self.assertEqual(detail['replay_reason'], reason)
            for key in ('can_replay','replay_reason','attempts_used','attempts_remaining'):
                self.assertEqual(detail[key], listing[key])

    def test_not_open_yet_or_expired_start_does_not_spend_attempt(self):
        for key, delta in (('opensAt', 10), ('closesAt', -10)):
            self.station.submission_config['limits'] = {key:(timezone.now()+timedelta(minutes=delta)).isoformat()}
            self.station.save()
            self.assertEqual(self.start().status_code, 403)
            self.assertEqual(StationSession.objects.count(), 0)

    def test_legacy_attempt_counts_after_start_and_history_is_preserved(self):
        legacy = StationSubmission.objects.create(team=self.team, station=self.station,
            status='graded', is_correct=False, score=0, submitted_at=timezone.now())
        self.assertEqual(self.detail()['attempts_used'], 1)
        self.assertEqual(self.start().status_code, 200)
        self.answer()
        self.assertEqual(self.detail()['attempts_used'], 2)
        legacy.refresh_from_db()
        self.assertIsNotNone(legacy.station_session_id)
        self.assertEqual(StationSubmission.objects.count(), 2)

    def test_new_attempt_resets_shared_draft_and_timer(self):
        self.start()
        first = StationSession.objects.get()
        TeamFormDraft.objects.create(team=self.team, station=self.station, response_payload={'old':True})
        self.answer()
        self.start()
        self.assertFalse(TeamFormDraft.objects.exists())
        self.assertGreater(StationSession.objects.get(status='active').entered_at, first.entered_at)

    def test_form_payload_keeps_closed_result_and_exposes_start_rights(self):
        self.start()
        self.answer(True)
        payload = self.client.get('/api/my-team/forms', HTTP_AUTHORIZATION=f'Bearer {self.token}').json()['accessible_forms'][0]
        self.assertTrue(payload['requires_start'])
        self.assertFalse(payload['can_replay'])
        self.assertEqual(payload['replay_reason'], 'passed')
        self.assertIsNotNone(payload['my_submission'])

    def test_ungraded_manual_questions_keep_pass_fail_and_threshold_pending(self):
        self.station.submission_config = {'quiz':{'autoScore':True}, 'items':[
            {'id':'q1','type':'quiz','question':'Q','options':['A','B'],'correctOption':1,'points':10},
            {'id':'essay','type':'text','label':'Explain'},
        ]}
        for mode in ('pass_fail', 'threshold'):
            self.station.scoring_mode = mode
            self.station.pass_threshold = 1
            self.station.save()
            self.assertEqual(self.start().status_code, 200)
            self.assertEqual(self.answer(True).status_code, 201)
            self.assertEqual(self.detail()['replay_reason'], 'pending_result')
            self.assertFalse(self.detail()['can_replay'])
            self.assertFalse(ScoreEntry.objects.exists())
            # Cancel this fixture so the next mode begins with a clean attempt.
            StationSession.objects.filter(team=self.team).update(status='cancelled')
