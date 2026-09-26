from typing import Any
from django.db import transaction
from api.models import QuestionBankItem, Station
from api.services.read_mostly_cache import schedule_station_config_invalidation

@transaction.atomic
def import_questions(sub_event_id: int, items: list[dict[str, Any]], replace=False) -> dict[str, int]:
    """
    Imports a list of questions into a SubEvent's question bank.
    items: [{"question": "...", "options": ["A","B"], "correctOption": 0, "points": 1, "tags": []}]
    """
    if not isinstance(items, list) or not items or any(not isinstance(item, dict) for item in items):
        raise ValueError("invalid_items")
    # Serialize bank changes for an event; replacement is validated before deletion.
    from api.models import SubEvent
    SubEvent.objects.select_for_update().get(id=sub_event_id)
    to_create = []
    max_order = 0 if replace else QuestionBankItem.objects.filter(sub_event_id=sub_event_id).count()
    for item in items:
        if not isinstance(item.get("question"), str) or not item["question"].strip():
            continue
        
        item_type = item.get("type", "quiz")
        if item_type not in ("quiz", "text"):
            item_type = "quiz"

        options = item.get("options", [])
        if not isinstance(options, list) or (item_type == "quiz" and len(options) < 2):
            continue
        
        correct_option = item.get("correctOption")
        if correct_option is not None and (type(correct_option) is not int or not 0 <= correct_option < len(options)):
            raise ValueError("invalid_correct_option")
        if not isinstance(correct_option, int):
            correct_option = None
            
        correct_text = item.get("correctText")
        if not isinstance(correct_text, list):
            correct_text = []

        try:
            points = int(item.get("points", 1))
        except (TypeError, ValueError):
            points = 1

        to_create.append(
            QuestionBankItem(
                sub_event_id=sub_event_id,
                type=item_type,
                question=item["question"],
                options=options,
                correct_option=correct_option,
                correct_text=correct_text,
                explanation=str(item.get("explanation") or "").strip(),
                points=points,
                order=max_order,
                tags=item.get("tags", []) if isinstance(item.get("tags"), list) else []
            )
        )
        max_order += 1

    if len(to_create) != len(items):
        raise ValueError("invalid_questions")
    if replace:
        clear_questions(sub_event_id)
    if to_create:
        QuestionBankItem.objects.bulk_create(to_create)
    # Question-bank writes are invalidated explicitly: bulk_create emits no
    # signals, while a replace/delete can affect many rows and must not enqueue
    # one Redis callback per question.
    schedule_station_config_invalidation(sub_event_id)

    return {"imported": len(to_create)}


@transaction.atomic
def clear_questions(sub_event_id: int) -> None:
    from api.models import SubEvent
    SubEvent.objects.select_for_update().get(id=sub_event_id)
    QuestionBankItem.objects.filter(sub_event_id=sub_event_id).delete()
    # Explicit selections must not silently reference deleted questions.
    for station in Station.objects.select_for_update().filter(sub_event_id=sub_event_id):
        config = station.submission_config or {}
        if config.get("bank", {}).get("itemIds"):
            config["bank"]["itemIds"] = []
            station.submission_config = config
            station.save(update_fields=["submission_config"])
    schedule_station_config_invalidation(sub_event_id)

def update_question(sub_event_id: int, item_id: int, **fields: Any) -> QuestionBankItem:
    """Update one question bank item. Raises QuestionBankItem.DoesNotExist if not
    found or not belonging to sub_event_id; ValueError on bad correctOption."""
    item = QuestionBankItem.objects.get(id=item_id, sub_event_id=sub_event_id)

    if "type" in fields:
        new_type = fields["type"]
        if new_type in ("quiz", "text"):
            item.type = new_type
    if "question" in fields:
        item.question = str(fields["question"] or "").strip()
    if "explanation" in fields:
        item.explanation = str(fields["explanation"] or "").strip()
    if "options" in fields:
        options = fields["options"]
        if not isinstance(options, list):
            raise ValueError("invalid_options")
        item.options = options
    if "correctOption" in fields:
        correct = fields["correctOption"]
        if correct is not None:
            if not isinstance(correct, int) or isinstance(correct, bool):
                raise ValueError("invalid_correct_option")
            if item.type == "quiz":
                options = item.options if isinstance(item.options, list) else []
                if not (0 <= correct < len(options)):
                    raise ValueError("correct_option_out_of_range")
        item.correct_option = correct
    if "correctText" in fields:
        correct_text = fields["correctText"]
        item.correct_text = correct_text if isinstance(correct_text, list) else []
    if "points" in fields:
        try:
            item.points = int(fields["points"])
        except (TypeError, ValueError):
            raise ValueError("invalid_points")
    if "order" in fields:
        try:
            item.order = int(fields["order"])
        except (TypeError, ValueError):
            raise ValueError("invalid_order")
    if "tags" in fields:
        tags = fields["tags"]
        item.tags = tags if isinstance(tags, list) else []
    if "active" in fields:
        item.active = bool(fields["active"])

    # Validate correct_option against (possibly just-updated) options even
    # when only options changed without correctOption in this call.
    if item.type == "quiz" and "options" in fields and "correctOption" not in fields:
        options = item.options if isinstance(item.options, list) else []
        if item.correct_option is not None and not (0 <= item.correct_option < len(options)):
            raise ValueError("correct_option_out_of_range")

    item.save()
    schedule_station_config_invalidation(sub_event_id)
    return item


def delete_question(sub_event_id: int, item_id: int) -> None:
    """Delete one question bank item. Raises QuestionBankItem.DoesNotExist if not
    found or not belonging to sub_event_id."""
    item = QuestionBankItem.objects.get(id=item_id, sub_event_id=sub_event_id)
    item.delete()
    schedule_station_config_invalidation(sub_event_id)


def effective_quiz_items(station: Station) -> list[dict[str, Any]]:
    """
    Returns the merged quiz items for a station.
    Includes both bank refs (with bankItemId injected) and inline items.
    """
    from api.services.submission_config_service import normalize_config

    config = station.submission_config or {}
    # Use the normalized config so legacy shapes (`quiz.items`, `form.fields`,
    # `attachment`) convert to canonical items first — effective_quiz_items
    # must not silently drop inline quiz items just because a station
    # predates the unified `items` list shape.
    normalized = normalize_config(config)
    inline_items = normalized.get("items", [])

    bank_config = normalized.get("bank", {})
    use_all = bank_config.get("useAll", False)

    if use_all:
        # Dynamic: use the WHOLE event bank, in bank order. Newly imported
        # questions show up automatically — no per-station re-selection needed.
        qs = list(
            QuestionBankItem.objects.filter(
                sub_event=station.sub_event, active=True,
            ).order_by("order", "id")
        )
        bank_item_ids = [obj.id for obj in qs]
        items_by_id = {obj.id: obj for obj in qs}
    else:
        bank_item_ids = bank_config.get("itemIds", [])
        items_by_id = {}
        if bank_item_ids:
            items_by_id = {
                obj.id: obj
                for obj in QuestionBankItem.objects.filter(
                    id__in=bank_item_ids, active=True,
                )
            }

    bank_items = []
    if bank_item_ids:
        for b_id in bank_item_ids:
            if b_id in items_by_id:
                obj = items_by_id[b_id]
                bank_items.append({
                    "id": f"bank-{obj.id}",
                    "bankItemId": obj.id,
                    "type": obj.type,
                    "question": obj.question,
                    "options": obj.options,
                    "correctOption": obj.correct_option,
                    "correctText": obj.correct_text,
                    "explanation": obj.explanation,
                    "points": obj.points,
                    "required": True, # bank questions are implicitly required
                })
    
    # Return shallow copies — callers (public_config) mutate items in place to
    # strip answer keys, and these dicts must not alias the live
    # `station.submission_config["items"]` entries or a later grade_quiz call
    # in the same process would see the answers already stripped.
    inline_quiz = [
        dict(it) for it in inline_items
        if isinstance(it, dict) and it.get("type") in ("quiz", "text")
    ]
    return bank_items + inline_quiz

def bank_item_id_of(local_id: str) -> int | None:
    """
    Extracts bankItemId from a local_id if it's a bank ref (e.g. 'bank-123' -> 123).
    """
    if local_id and isinstance(local_id, str) and local_id.startswith("bank-"):
        try:
            return int(local_id.split("-", 1)[1])
        except ValueError:
            return None
    return None
