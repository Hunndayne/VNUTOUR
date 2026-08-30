from typing import Any
from django.db import transaction
from api.models import QuestionBankItem, Station

def import_questions(sub_event_id: int, items: list[dict[str, Any]]) -> dict[str, int]:
    """
    Imports a list of questions into a SubEvent's question bank.
    items: [{"question": "...", "options": ["A","B"], "correctOption": 0, "points": 1, "tags": []}]
    """
    to_create = []
    max_order = QuestionBankItem.objects.filter(sub_event_id=sub_event_id).count()
    for item in items:
        if "question" not in item or "options" not in item or len(item["options"]) < 2:
            continue
        
        correct_option = item.get("correctOption")
        if not isinstance(correct_option, int):
            correct_option = None
            
        try:
            points = int(item.get("points", 1))
        except (TypeError, ValueError):
            points = 1

        to_create.append(
            QuestionBankItem(
                sub_event_id=sub_event_id,
                question=item["question"],
                options=item["options"],
                correct_option=correct_option,
                points=points,
                order=max_order,
                tags=item.get("tags", [])
            )
        )
        max_order += 1

    if to_create:
        QuestionBankItem.objects.bulk_create(to_create)

    return {"imported": len(to_create)}

def update_question(sub_event_id: int, item_id: int, **fields: Any) -> QuestionBankItem:
    """Update one question bank item. Raises QuestionBankItem.DoesNotExist if not
    found or not belonging to sub_event_id; ValueError on bad correctOption."""
    item = QuestionBankItem.objects.get(id=item_id, sub_event_id=sub_event_id)

    if "question" in fields:
        item.question = str(fields["question"] or "").strip()
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
            options = item.options if isinstance(item.options, list) else []
            if not (0 <= correct < len(options)):
                raise ValueError("correct_option_out_of_range")
        item.correct_option = correct
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
    if "options" in fields and "correctOption" not in fields:
        options = item.options if isinstance(item.options, list) else []
        if item.correct_option is not None and not (0 <= item.correct_option < len(options)):
            raise ValueError("correct_option_out_of_range")

    item.save()
    return item


def delete_question(sub_event_id: int, item_id: int) -> None:
    """Delete one question bank item. Raises QuestionBankItem.DoesNotExist if not
    found or not belonging to sub_event_id."""
    item = QuestionBankItem.objects.get(id=item_id, sub_event_id=sub_event_id)
    item.delete()


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
    bank_item_ids = bank_config.get("itemIds", [])
    
    bank_items = []
    if bank_item_ids:
        # Fetch from DB and preserve order
        qs = QuestionBankItem.objects.filter(id__in=bank_item_ids, active=True)
        items_by_id = {item.id: item for item in qs}
        for b_id in bank_item_ids:
            if b_id in items_by_id:
                obj = items_by_id[b_id]
                bank_items.append({
                    "id": f"bank-{obj.id}",
                    "bankItemId": obj.id,
                    "type": "quiz",
                    "question": obj.question,
                    "options": obj.options,
                    "correctOption": obj.correct_option,
                    "points": obj.points,
                    "required": True, # bank questions are implicitly required
                })
    
    # Return shallow copies — callers (public_config) mutate items in place to
    # strip answer keys, and these dicts must not alias the live
    # `station.submission_config["items"]` entries or a later grade_quiz call
    # in the same process would see the answers already stripped.
    inline_quiz = [
        dict(it) for it in inline_items
        if isinstance(it, dict) and it.get("type") == "quiz"
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
