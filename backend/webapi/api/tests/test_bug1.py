import pytest
from django.urls import reverse
from api.models import Team, Station, SubEvent, ProgramPhase, StationSession, StationSubmission, QuestionBankItem, TeamMembership, Account, Participant, PhaseRoster, SystemSetting
from django.utils import timezone
from datetime import timedelta
from api.services.auth_service import generate_session
from api.services.program_service import set_current_sub_event

@pytest.mark.django_db
def test_bug1_replay_after_all_stations(client):
    phase = ProgramPhase.objects.create(key="test", label="Test Phase", is_current=True)
    sub_event = SubEvent.objects.create(phase=phase, name="Test Event", type="station", replay_after_all=True)
    set_current_sub_event(sub_event.id)
    
    # Create an active station with a form
    config = {
        "items": [],
        "bank": {"useAll": True, "mixStationQuiz": True},
        "quiz": {"randomCount": 1},
        "flow": {"checkoutAfterSubmit": True},
        "limits": {"maxSubmissions": 0}
    }
    st1 = Station.objects.create(sub_event=sub_event, code="S1", name="S1", active=True, submission_config=config, order=1, scoring_mode=Station.SCORING_SCORE_ONLY)
    st2 = Station.objects.create(sub_event=sub_event, code="S2", name="S2", active=True, submission_config=config, order=2)
    
    QuestionBankItem.objects.create(sub_event=sub_event, active=True, type="quiz")
    QuestionBankItem.objects.create(sub_event=sub_event, active=True, type="quiz")
    
    acc = Account.objects.create(mssv="123456", role=Account.ROLE_PARTICIPANT)
    part = Participant.objects.create(mssv="123456", full_name="A B")
    team = Team.objects.create(code="T1", name="T1", approval_status=Team.APPROVAL_APPROVED)
    TeamMembership.objects.create(team=team, participant=part)
    PhaseRoster.objects.create(team=team, phase=phase)
    
    token = generate_session(acc)
    auth_headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
    
    # Team visited and failed S1
    s1_session1 = StationSession.objects.create(
        team=team, station=st1, phase=phase, sub_event=sub_event, entered_at=timezone.now() - timedelta(minutes=10),
        status=StationSession.STATUS_CLOSED, exited_at=timezone.now() - timedelta(minutes=5),
        outcome=StationSession.OUTCOME_FAILED, score=5
    )
    StationSubmission.objects.create(
        team=team, station=st1, station_session=s1_session1,
        status=StationSubmission.STATUS_GRADED, score=5,
        submitted_at=timezone.now() - timedelta(minutes=6)
    )
    
    # Team visited and failed S2
    s2_session = StationSession.objects.create(
        team=team, station=st2, phase=phase, sub_event=sub_event, entered_at=timezone.now() - timedelta(minutes=4),
        status=StationSession.STATUS_CLOSED, exited_at=timezone.now() - timedelta(minutes=1),
        outcome=StationSession.OUTCOME_FAILED, score=0
    )
    StationSubmission.objects.create(
        team=team, station=st2, station_session=s2_session,
        status=StationSubmission.STATUS_GRADED, score=0,
        submitted_at=timezone.now() - timedelta(minutes=2)
    )
    
    # 1. state view should show replay allowed for S1
    resp2 = client.get("/api/my-team/stations", **auth_headers)
    assert resp2.status_code == 200
    data = resp2.json()
    assert data["replay_enabled"] is True
    assert data["all_visited"] is True
    s1_data = next(s for s in data["stations"] if s["station_id"] == st1.id)
    assert s1_data["replay_locked"] is False
    
    # 2. Team opens a NEW session at S1
    s1_session2 = StationSession.objects.create(
        team=team, station=st1, phase=phase, sub_event=sub_event, entered_at=timezone.now(),
        status=StationSession.STATUS_ACTIVE
    )
    
    # 3. Form payload should NOT say already submitted, because it's a new session
    resp3 = client.get("/api/my-team/forms", **auth_headers)
    assert resp3.status_code == 200
    form_data = resp3.json()
    s1_form = next(f for f in form_data["accessible_forms"] if f["station_id"] == st1.id)
    assert s1_form["my_submission"] is None
    
    # 4. Submit new form
    resp4 = client.post(f"/api/my-team/forms/{st1.id}/submit", data={"answers": {}}, content_type="application/json", **auth_headers)
    assert resp4.status_code in (200, 201)
    
    # Update new session so the score calculation works as intended
    s1_session2.status = StationSession.STATUS_CLOSED
    s1_session2.score = 0
    s1_session2.outcome = StationSession.OUTCOME_FAILED
    s1_session2.save()
    
    # 5. Check score (best of all attempts)
    assert StationSubmission.objects.filter(team=team, station=st1).count() == 2
    from api.services.station_service import _sync_station_score_entry
    _sync_station_score_entry(team, st1)
    from api.models import ScoreEntry
    score = ScoreEntry.objects.filter(team=team, kind="station").first()
    # The new submission gets 0 score, but best is 5
    assert score.points == 5
