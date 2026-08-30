import pytest
from django.db import IntegrityError
from api.models import QuestionBankItem, Station, Team, SubEvent, TeamFormVariant
from api.services.team_form_variant_service import variant_item_ids
from api.services.question_bank_service import (
    effective_quiz_items, update_question, delete_question,
)
from api.services.submission_config_service import public_config, grade_quiz

pytestmark = pytest.mark.django_db

def test_shared_question_bank_dedup(event_fixture, team_fixture, station_fixture):
    # Setup
    event = event_fixture
    team = team_fixture
    station_a = station_fixture(code="A", sub_event=event)
    station_b = station_fixture(code="B", sub_event=event)
    
    q1 = QuestionBankItem.objects.create(sub_event=event, question="Q1", options=["A", "B"], correct_option=0)
    q2 = QuestionBankItem.objects.create(sub_event=event, question="Q2", options=["A", "B"], correct_option=0)
    
    # Config station A to use Q1, Q2, draw 1
    station_a.submission_config = {
        "bank": {"itemIds": [q1.id, q2.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 1},
        "items": []
    }
    station_a.save()
    
    # Config station B to use Q1, Q2, draw 1
    station_b.submission_config = {
        "bank": {"itemIds": [q1.id, q2.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 1},
        "items": []
    }
    station_b.save()
    
    # Team visits A
    draw_a = variant_item_ids(station_a, team)
    assert len(draw_a) == 1
    drawn_id_a = draw_a[0]
    
    # Team visits B, should get the OTHER question
    draw_b = variant_item_ids(station_b, team)
    assert len(draw_b) == 1
    drawn_id_b = draw_b[0]
    
    assert drawn_id_a != drawn_id_b

def test_shared_question_bank_soft_dedup_repeats(event_fixture, team_fixture, station_fixture):
    event = event_fixture
    team = team_fixture
    station_a = station_fixture(code="A", sub_event=event)
    station_b = station_fixture(code="B", sub_event=event)
    
    q1 = QuestionBankItem.objects.create(sub_event=event, question="Q1", options=["A", "B"], correct_option=0)
    
    # Only 1 question in bank, but both stations need 1. Team visits both.
    station_a.submission_config = {
        "bank": {"itemIds": [q1.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 1},
        "items": []
    }
    station_a.save()
    
    station_b.submission_config = {
        "bank": {"itemIds": [q1.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 1},
        "items": []
    }
    station_b.save()
    
    draw_a = variant_item_ids(station_a, team)
    assert draw_a == [f"bank-{q1.id}"]
    
    draw_b = variant_item_ids(station_b, team)
    # It must repeat because there are no unseen questions left
    assert draw_b == [f"bank-{q1.id}"]

def test_materialize_when_random_count_is_zero(event_fixture, team_fixture, station_fixture):
    event = event_fixture
    team = team_fixture
    station = station_fixture(code="A", sub_event=event)
    q1 = QuestionBankItem.objects.create(sub_event=event, question="Q1", options=["A", "B"], correct_option=0)
    
    station.submission_config = {
        "bank": {"itemIds": [q1.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 0}, # Serve all
        "items": []
    }
    station.save()
    
    # First access materializes
    draw = variant_item_ids(station, team)
    assert draw == [f"bank-{q1.id}"]
    assert TeamFormVariant.objects.filter(team=team, station=station).exists()

def test_inline_items_not_deduped(event_fixture, team_fixture, station_fixture):
    event = event_fixture
    team = team_fixture
    station_a = station_fixture(code="A", sub_event=event)
    station_b = station_fixture(code="B", sub_event=event)
    
    inline_quiz = {"id": "quiz-1", "type": "quiz", "question": "Inline"}
    
    station_a.submission_config = {
        "bank": {"itemIds": [], "mixStationQuiz": False},
        "quiz": {"randomCount": 1},
        "items": [inline_quiz]
    }
    station_a.save()
    
    station_b.submission_config = {
        "bank": {"itemIds": [], "mixStationQuiz": False},
        "quiz": {"randomCount": 1},
        "items": [inline_quiz] # Same inline ID
    }
    station_b.save()
    
    draw_a = variant_item_ids(station_a, team)
    draw_b = variant_item_ids(station_b, team)

    assert draw_a == ["quiz-1"]
    assert draw_b == ["quiz-1"] # Should not be deduped across stations


def test_effective_quiz_items_excludes_text_and_attachment(event_fixture, station_fixture):
    """BLOCKER 2 regression: non-quiz inline items must not be duplicated."""
    event = event_fixture
    station = station_fixture(code="A", sub_event=event)
    q1 = QuestionBankItem.objects.create(sub_event=event, question="Q1", options=["A", "B"], correct_option=0)

    station.submission_config = {
        "bank": {"itemIds": [q1.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 0},
        "items": [
            {"id": "field-1", "type": "text", "label": "Ten doi"},
            {"id": "quiz-1", "type": "quiz", "question": "Inline quiz", "options": ["A", "B"], "correctOption": 1},
            {"id": "file-1", "type": "attachment", "maxFiles": 1},
        ],
    }
    station.save()

    effective = effective_quiz_items(station)
    assert all(it["type"] == "quiz" for it in effective)
    # exactly 1 bank quiz + 1 inline quiz, no text/attachment leaked in
    assert len(effective) == 2

    conf = public_config(station.submission_config, effective_quiz_items=effective)
    text_items = [it for it in conf["items"] if it["type"] == "text"]
    attach_items = [it for it in conf["items"] if it["type"] == "attachment"]
    quiz_items = [it for it in conf["items"] if it["type"] == "quiz"]
    assert len(text_items) == 1
    assert len(attach_items) == 1
    assert len(quiz_items) == 2


def test_mix_station_quiz_false_serves_bank_n_plus_all_inline(event_fixture, station_fixture):
    event = event_fixture
    station = station_fixture(code="A", sub_event=event)
    q1 = QuestionBankItem.objects.create(sub_event=event, question="Q1", options=["A", "B"], correct_option=0)
    q2 = QuestionBankItem.objects.create(sub_event=event, question="Q2", options=["A", "B"], correct_option=0)
    q3 = QuestionBankItem.objects.create(sub_event=event, question="Q3", options=["A", "B"], correct_option=0)

    station.submission_config = {
        "bank": {"itemIds": [q1.id, q2.id, q3.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 1},
        "items": [
            {"id": "quiz-a", "type": "quiz", "question": "Inline A", "options": ["A", "B"], "correctOption": 0},
            {"id": "quiz-b", "type": "quiz", "question": "Inline B", "options": ["A", "B"], "correctOption": 0},
        ],
    }
    station.save()
    team = Team.objects.create(code="TMIX1", name="Mix False", approval_status=Team.APPROVAL_APPROVED, qr_token="tokmix1")

    drawn = variant_item_ids(station, team)
    # 1 bank question + both inline questions = 3
    assert len(drawn) == 3
    inline_count = sum(1 for d in drawn if d in ("quiz-a", "quiz-b"))
    bank_count = sum(1 for d in drawn if d.startswith("bank-"))
    assert inline_count == 2
    assert bank_count == 1


def test_mix_station_quiz_true_draws_from_merged_pool(event_fixture, station_fixture):
    event = event_fixture
    station = station_fixture(code="A", sub_event=event)
    q1 = QuestionBankItem.objects.create(sub_event=event, question="Q1", options=["A", "B"], correct_option=0)
    q2 = QuestionBankItem.objects.create(sub_event=event, question="Q2", options=["A", "B"], correct_option=0)

    station.submission_config = {
        "bank": {"itemIds": [q1.id, q2.id], "mixStationQuiz": True},
        "quiz": {"randomCount": 2},
        "items": [
            {"id": "quiz-a", "type": "quiz", "question": "Inline A", "options": ["A", "B"], "correctOption": 0},
            {"id": "quiz-b", "type": "quiz", "question": "Inline B", "options": ["A", "B"], "correctOption": 0},
        ],
    }
    station.save()
    team = Team.objects.create(code="TMIX2", name="Mix True", approval_status=Team.APPROVAL_APPROVED, qr_token="tokmix2")

    drawn = variant_item_ids(station, team)
    # exactly N=2 total drawn from the merged pool of 4 (2 bank + 2 inline)
    assert len(drawn) == 2


def test_concurrent_stations_second_draw_avoids_seen_bank_items(event_fixture, team_fixture, station_fixture):
    """§8.5: sequential draws for the same team across two stations must not
    repeat a bank question already seen, as long as unseen ones remain."""
    event = event_fixture
    team = team_fixture
    station_a = station_fixture(code="A", sub_event=event)
    station_b = station_fixture(code="B", sub_event=event)

    q1 = QuestionBankItem.objects.create(sub_event=event, question="Q1", options=["A", "B"], correct_option=0)
    q2 = QuestionBankItem.objects.create(sub_event=event, question="Q2", options=["A", "B"], correct_option=0)
    q3 = QuestionBankItem.objects.create(sub_event=event, question="Q3", options=["A", "B"], correct_option=0)

    for station in (station_a, station_b):
        station.submission_config = {
            "bank": {"itemIds": [q1.id, q2.id, q3.id], "mixStationQuiz": False},
            "quiz": {"randomCount": 1},
            "items": [],
        }
        station.save()

    draw_a = variant_item_ids(station_a, team)
    draw_b = variant_item_ids(station_b, team)

    assert set(draw_a).isdisjoint(set(draw_b))


def test_grade_quiz_scores_bank_questions(event_fixture, team_fixture, station_fixture):
    """§8.8: grading covers the exact set served, including bank questions,
    with points matching the bank item's configured points."""
    event = event_fixture
    team = team_fixture
    station = station_fixture(code="A", sub_event=event)
    q1 = QuestionBankItem.objects.create(
        sub_event=event, question="Q1", options=["A", "B"], correct_option=1, points=3,
    )
    station.submission_config = {
        "bank": {"itemIds": [q1.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 0},
        "items": [],
    }
    station.save()

    drawn = variant_item_ids(station, team)
    assert drawn == [f"bank-{q1.id}"]

    effective = effective_quiz_items(station)
    response_payload = {"quiz": [{"id": drawn[0], "selectedOption": 1}]}
    result = grade_quiz(station.submission_config, response_payload, drawn, effective_quiz_items=effective)

    assert result["correct_count"] == 1
    assert result["total"] == 1
    assert result["points"] == 3
    assert result["max_points"] == 3
    assert result["all_correct"] is True


def test_backward_compat_station_without_bank_block(event_fixture, team_fixture, station_fixture):
    """§8.9: an old-shaped station config with no `bank` key at all must behave
    exactly as before — no errors, same question count."""
    event = event_fixture
    team = team_fixture
    station = station_fixture(code="A", sub_event=event)
    station.submission_config = {
        "quiz": {"randomCount": 0},
        "items": [
            {"id": "quiz-1", "type": "quiz", "question": "Old inline 1", "options": ["A", "B"], "correctOption": 0},
            {"id": "quiz-2", "type": "quiz", "question": "Old inline 2", "options": ["A", "B"], "correctOption": 1},
        ],
    }
    station.save()

    drawn = variant_item_ids(station, team)
    assert set(drawn) == {"quiz-1", "quiz-2"}

    assert len(effective_quiz_items(station)) == 2

    conf = public_config(station.submission_config, drawn, effective_quiz_items=effective_quiz_items(station))
    assert len(conf["items"]) == 2
    for item in conf["items"]:
        assert "correctOption" not in item

    # grade_quiz draws its own fresh effective-items snapshot (as the real
    # views do) — this must not be affected by public_config's earlier
    # mutation to strip answer keys.
    response_payload = {"quiz": [{"id": "quiz-1", "selectedOption": 0}, {"id": "quiz-2", "selectedOption": 1}]}
    result = grade_quiz(
        station.submission_config, response_payload, drawn,
        effective_quiz_items=effective_quiz_items(station),
    )
    assert result["correct_count"] == 2
    assert result["total"] == 2


def test_edit_and_delete_bank_item_does_not_reshuffle_committed_variant(event_fixture, team_fixture, station_fixture):
    """§8.6: editing/removing bank questions must not reshuffle a team's
    already-committed draw; a deleted question simply drops out, the rest stay."""
    event = event_fixture
    team = team_fixture
    station = station_fixture(code="A", sub_event=event)
    q1 = QuestionBankItem.objects.create(sub_event=event, question="Q1", options=["A", "B"], correct_option=0)
    q2 = QuestionBankItem.objects.create(sub_event=event, question="Q2", options=["A", "B"], correct_option=0)

    station.submission_config = {
        "bank": {"itemIds": [q1.id, q2.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 0},
        "items": [],
    }
    station.save()

    drawn_before = variant_item_ids(station, team)
    assert set(drawn_before) == {f"bank-{q1.id}", f"bank-{q2.id}"}

    # Edit q1's question text — should not disturb the committed variant.
    update_question(event.id, q1.id, question="Q1 edited")
    drawn_after_edit = variant_item_ids(station, team)
    assert set(drawn_after_edit) == set(drawn_before)

    # Delete q2 — it should drop out of the variant, q1 stays.
    delete_question(event.id, q2.id)
    drawn_after_delete = variant_item_ids(station, team)
    assert f"bank-{q2.id}" not in drawn_after_delete
    assert f"bank-{q1.id}" in drawn_after_delete


def test_effective_quiz_items_does_not_alias_config(event_fixture, station_fixture):
    """public_config strips answer keys in place on the item dicts it is
    handed; effective_quiz_items must return copies so that does not corrupt
    the station's stored submission_config or a later effective_quiz_items()
    call in the same process."""
    event = event_fixture
    station = station_fixture(code="A", sub_event=event)
    station.submission_config = {
        "quiz": {"randomCount": 0},
        "items": [
            {"id": "quiz-1", "type": "quiz", "question": "Q", "options": ["A", "B"], "correctOption": 1},
        ],
    }
    station.save()

    first = effective_quiz_items(station)
    public_config(station.submission_config, effective_quiz_items=first)

    # Stored config must be untouched.
    assert station.submission_config["items"][0]["correctOption"] == 1

    # A fresh call must still see the answer key.
    second = effective_quiz_items(station)
    assert second[0]["correctOption"] == 1


def test_random_count_zero_soft_dedup_across_stations(event_fixture, team_fixture, station_fixture):
    """Mục 5: randomCount=0 also applies soft dedup — prefers unseen bank
    items, falls back to repeats only when the station's whole bank pool has
    already been seen (never serves zero questions)."""
    event = event_fixture
    team = team_fixture
    station_a = station_fixture(code="A", sub_event=event)
    station_b = station_fixture(code="B", sub_event=event)

    q1 = QuestionBankItem.objects.create(sub_event=event, question="Q1", options=["A", "B"], correct_option=0)
    q2 = QuestionBankItem.objects.create(sub_event=event, question="Q2", options=["A", "B"], correct_option=0)

    station_a.submission_config = {
        "bank": {"itemIds": [q1.id, q2.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 0},
        "items": [],
    }
    station_a.save()
    # station B's bank pool is a subset already fully covered by station A
    station_b.submission_config = {
        "bank": {"itemIds": [q1.id], "mixStationQuiz": False},
        "quiz": {"randomCount": 0},
        "items": [],
    }
    station_b.save()

    draw_a = variant_item_ids(station_a, team)
    assert set(draw_a) == {f"bank-{q1.id}", f"bank-{q2.id}"}

    # station B's only bank item (q1) was already seen — soft dedup must not
    # return an empty list, it repeats q1.
    draw_b = variant_item_ids(station_b, team)
    assert draw_b == [f"bank-{q1.id}"]

