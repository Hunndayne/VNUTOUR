import pytest
from django.urls import reverse
from api.models import Team, Station, SubEvent, ProgramPhase, QuestionBankItem, TeamMembership, Account, Participant, PhaseRoster, TeamFormVariant, SystemSetting
from django.utils import timezone
from api.services.team_form_variant_service import variant_item_ids
from api.services.program_service import set_current_sub_event
import json

@pytest.mark.django_db
def test_bug2_shared_bank_deduplication():
    phase = ProgramPhase.objects.create(key="test", label="Test Phase", is_current=True)
    sub_event = SubEvent.objects.create(phase=phase, name="Test Event", type="station", replay_after_all=True)
    set_current_sub_event(sub_event.id)
    
    # Create config for shared bank
    config = {
        "items": [],
        "bank": {"useAll": True, "mixStationQuiz": True, "itemIds": []},
        "quiz": {"randomCount": 1},
        "flow": {"checkoutAfterSubmit": True},
        "limits": {"maxSubmissions": 1}
    }
    st1 = Station.objects.create(sub_event=sub_event, code="S1", name="S1", active=True, submission_config=config, order=1)
    st2 = Station.objects.create(sub_event=sub_event, code="S2", name="S2", active=True, submission_config=config, order=2)
    
    q1 = QuestionBankItem.objects.create(sub_event=sub_event, active=True, type="quiz")
    q2 = QuestionBankItem.objects.create(sub_event=sub_event, active=True, type="quiz")
    
    team = Team.objects.create(code="T1", name="T1", approval_status=Team.APPROVAL_APPROVED)
    
    # 1. Simulate the stringified JSON bug by inserting the first variant manually
    # with item_ids as a STRING instead of a LIST.
    # Older SQLite/MySQL would return it as string in JSONField
    item_ids_str = f'["bank-{q1.id}"]'
    TeamFormVariant.objects.create(
        team=team, station=st1,
        item_ids=item_ids_str,  # Stringified JSON array
    )
    
    # 2. Ensure variant for st2 is generated.
    # It should parse item_ids_str from st1 and avoid returning q1.id again.
    v2_items = variant_item_ids(st2, team)
    
    # 3. Check v2.item_ids is a list containing exactly q2.id
    assert len(v2_items) == 1
    assert str(v2_items[0]) == f"bank-{q2.id}"
