"""
Station submission config — canonical shape and readers.

A station form is an **ordered list of items**, so admins can interleave free-text
questions, quiz questions and the file-upload block in any order:

    {
      "brief": "...",
      "items": [
        {"id": "field-a1", "type": "text", "label": "...", "placeholder": "...",
         "required": true},
        {"id": "quiz-b2", "type": "quiz", "question": "...",
         "options": ["...", "..."], "correctOption": 0, "points": 1},
        {"id": "file-c3", "type": "attachment", "maxFiles": 1, "maxSizeMb": 20,
         "allowedTypes": "JPG, PNG, PDF", "note": ""}
      ],
      "quiz": {"autoScore": false, "randomCount": 0},
      "limits": {"maxSubmissions": 0, "closeOnCorrect": false, "manualClosed": false},
      "flow": {"checkoutAfterSubmit": true}
    }

Configs saved before this shape existed used three fixed sections
(`form.fields`, `quiz.items`, `attachment`). `normalize_config` converts those on
read, in their original display order, so old stations keep working untouched.

Only one attachment item is meaningful: uploads arrive as a single `files` list
and are stored in one `attachment_payload`. Extra attachment items are dropped.

`quiz.randomCount` serves a random subset of the quiz items — "5 câu trong bộ 20".
0, or a count at/above the bank size, sends every question. The draw is per
**team**, not per person: which questions a team drew is stored once in
`TeamFormVariant`, so every member opening the form sees the same set and a reload
never reshuffles it. Callers pass that stored id list as `item_ids` to
`public_config` and `grade_quiz`, which then ignore questions outside the draw.

`flow.checkoutAfterSubmit` decides how a visit ends at a station that has a form:
on (the default) the team is still scanned out afterwards, off means submitting
counts as leaving. It sits here rather than on the Station because it only has
meaning where a form exists, and it is edited alongside the form.
"""

from __future__ import annotations

from copy import deepcopy

TYPE_TEXT = "text"
TYPE_QUIZ = "quiz"
TYPE_ATTACHMENT = "attachment"

ITEM_TYPES = (TYPE_TEXT, TYPE_QUIZ, TYPE_ATTACHMENT)

# Keys that would leak the right answer to participants.
_ANSWER_KEYS = (
    "correctOption", "correct_option",
    "correctAnswer", "correct_answer", "answer",
)


def _clean_str(value, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def _positive_int(value, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(value))
    except (TypeError, ValueError):
        return default


def item_points(item: dict) -> int:
    """Weight of a quiz item; defaults to 1 when unset or unparseable."""
    try:
        return max(0, int(item.get("points")))
    except (TypeError, ValueError):
        return 1


def _text_item(raw: dict, index: int) -> dict:
    return {
        "id": _clean_str(raw.get("id")) or f"field-{index}",
        "type": TYPE_TEXT,
        "label": _clean_str(raw.get("label")),
        "placeholder": _clean_str(raw.get("placeholder")),
        "required": raw.get("required", True) is not False,
    }


def _quiz_item(raw: dict, index: int) -> dict:
    options = [
        _clean_str(option)
        for option in (raw.get("options") if isinstance(raw.get("options"), list) else [])
    ]
    correct = raw.get("correctOption")
    if not isinstance(correct, int) or isinstance(correct, bool):
        correct = None
    return {
        "id": _clean_str(raw.get("id")) or f"quiz-{index}",
        "type": TYPE_QUIZ,
        "question": _clean_str(raw.get("question")),
        "options": options,
        "correctOption": correct,
        "points": item_points(raw),
        "required": raw.get("required", True) is not False,
    }


def _attachment_item(raw: dict, index: int) -> dict:
    return {
        "id": _clean_str(raw.get("id")) or f"file-{index}",
        "type": TYPE_ATTACHMENT,
        "maxFiles": _positive_int(raw.get("maxFiles"), 1),
        "maxSizeMb": _positive_int(raw.get("maxSizeMb"), 20),
        "allowedTypes": _clean_str(raw.get("allowedTypes"), "JPG, PNG, PDF"),
        "note": _clean_str(raw.get("note")),
        "required": bool(raw.get("required", False)),
    }


_BUILDERS = {
    TYPE_TEXT: _text_item,
    TYPE_QUIZ: _quiz_item,
    TYPE_ATTACHMENT: _attachment_item,
}


def _items_from_legacy(config: dict) -> list[dict]:
    """Convert the old three-section shape, preserving its display order."""
    items: list[dict] = []

    form = config.get("form")
    if isinstance(form, dict) and form.get("enabled"):
        for index, field in enumerate(form.get("fields") or []):
            if isinstance(field, dict):
                items.append(_text_item(field, index))

    quiz = config.get("quiz")
    if isinstance(quiz, dict) and quiz.get("enabled"):
        for index, entry in enumerate(quiz.get("items") or []):
            if isinstance(entry, dict):
                items.append(_quiz_item(entry, index))

    attachment = config.get("attachment")
    if isinstance(attachment, dict) and attachment.get("enabled"):
        items.append(_attachment_item(attachment, 0))

    return items


def _limits(config: dict) -> dict:
    limits = config.get("limits") if isinstance(config.get("limits"), dict) else {}
    try:
        max_submissions = max(0, int(limits.get("maxSubmissions") or 0))
    except (TypeError, ValueError):
        max_submissions = 0
        
    try:
        duration_minutes = max(0, int(limits.get("durationMinutes") or 0))
    except (TypeError, ValueError):
        duration_minutes = 0

    return {
        "maxSubmissions": max_submissions,
        "closeOnCorrect": bool(limits.get("closeOnCorrect")),
        "manualClosed": bool(limits.get("manualClosed")),
        "opensAt": _clean_str(limits.get("opensAt")),
        "closesAt": _clean_str(limits.get("closesAt")),
        "durationMinutes": duration_minutes,
    }


def _flow(config: dict) -> dict:
    """How the station visit ends once the form is submitted.

    Defaults to True so every check-in still has a matching check-out, which is
    what keeps a station's occupancy count honest. Stations where submitting the
    form obviously means "done" can turn it off and let the team walk away.
    """
    flow = config.get("flow") if isinstance(config.get("flow"), dict) else {}
    return {
        "checkoutAfterSubmit": flow.get("checkoutAfterSubmit", True) is not False,
    }


def normalize_config(config: dict | None) -> dict:
    """Return the config in canonical form, converting the legacy shape if needed."""
    config = config if isinstance(config, dict) else {}

    raw_items = config.get("items")
    if isinstance(raw_items, list):
        items = []
        seen_attachment = False
        for index, raw in enumerate(raw_items):
            if not isinstance(raw, dict):
                continue
            item_type = _clean_str(raw.get("type")) or TYPE_TEXT
            builder = _BUILDERS.get(item_type)
            if builder is None:
                continue
            if item_type == TYPE_ATTACHMENT:
                if seen_attachment:
                    continue
                seen_attachment = True
            items.append(builder(raw, index))
    else:
        items = _items_from_legacy(config)

    quiz = config.get("quiz") if isinstance(config.get("quiz"), dict) else {}
    try:
        random_count = max(0, int(quiz.get("randomCount") or 0))
    except (TypeError, ValueError):
        random_count = 0

    return {
        "antiCheat": config.get("antiCheat", True) is not False,
        "brief": _clean_str(config.get("brief")),
        "items": items,
        "bank": {
            "itemIds": config.get("bank", {}).get("itemIds", []),
            "useAll": bool(config.get("bank", {}).get("useAll", False)),
            "mixStationQuiz": bool(config.get("bank", {}).get("mixStationQuiz", False)),
        },
        "quiz": {
            "autoScore": bool(quiz.get("autoScore")),
            "randomCount": random_count,
            "randomizeOptions": bool(quiz.get("randomizeOptions")),
        },
        "limits": _limits(config),
        "flow": _flow(config),
    }


def checkout_after_submit(config: dict | None) -> bool:
    """Whether a team still has to be scanned out after submitting this form."""
    return normalize_config(config)["flow"]["checkoutAfterSubmit"]


def submission_items(
    config: dict | None,
    item_type: str | None = None,
    effective_quiz_items: list[dict] | None = None,
) -> list[dict]:
    """Canonical items, optionally filtered to one type, overriding quiz items if provided."""
    items = normalize_config(config)["items"]

    if effective_quiz_items is not None:
        # Merge in place so display order stays interleaved: each inline quiz
        # slot is replaced by its effective counterpart (same id), and any
        # bank-only questions (not backed by an inline item) are prepended —
        # bank first, inline after, per the shared-question-bank plan.
        effective_by_id = {
            item["id"]: item for item in effective_quiz_items if isinstance(item, dict)
        }
        inline_quiz_ids = {item["id"] for item in items if item["type"] == TYPE_QUIZ}
        bank_only = [
            item for item in effective_quiz_items
            if isinstance(item, dict) and item.get("id") not in inline_quiz_ids
        ]

        merged = list(bank_only)
        for item in items:
            if item["type"] == TYPE_QUIZ:
                merged.append(effective_by_id.get(item["id"], item))
            else:
                merged.append(item)
        items = merged

    if item_type is None:
        return items
    return [item for item in items if item["type"] == item_type]


def has_items(config: dict | None) -> bool:
    """Whether the station has a form worth showing to participants."""
    return bool(normalize_config(config)["items"])


def attachment_item(config: dict | None) -> dict | None:
    """The single file-upload item, wherever it sits in the order."""
    items = submission_items(config, TYPE_ATTACHMENT)
    return items[0] if items else None


def random_count(config: dict | None) -> int:
    """How many quiz questions each team is served; 0 means all of them."""
    return normalize_config(config)["quiz"]["randomCount"]


def quiz_item_ids(
    config: dict | None,
    effective_quiz_items: list[dict] | None = None,
) -> list[str]:
    """Ids of every quiz item in the bank, in display order."""
    return [item["id"] for item in submission_items(config, TYPE_QUIZ, effective_quiz_items)]


def _full_serve_order(available: list[str], kept: list[str]) -> list[str]:
    """Full-bank order that still remembers a prior partial draw.

    Returning `available` as-is when the target count no longer restricts
    anything (0, or the pool shrank to it) would forget which questions a
    team had already been served — so if `randomCount` is later raised back
    up, trimming the stored list to the new, smaller target must recover the
    original draw rather than an arbitrary prefix of the bank.
    """
    if not kept:
        return list(available)
    kept_set = set(kept)
    return kept + [item_id for item_id in available if item_id not in kept_set]


def draw_quiz_item_ids(
    config: dict | None,
    rng,
    keep: list[str] | None = None,
    effective_quiz_items: list[dict] | None = None,
    seen_bank_ids: set[int] | None = None,
) -> list[str]:
    """Pick the quiz ids to serve, reusing `keep` wherever it is still valid.
    
    If `mixStationQuiz` is false, it only randomizes from the bank items and always keeps inline items.
    If `mixStationQuiz` is true, it randomizes across all quiz items.
    Prioritizes items not in `seen_bank_ids` (soft dedup).
    """
    normalized = normalize_config(config)
    mix_station_quiz = normalized["bank"]["mixStationQuiz"]
    target = random_count(config)
    
    available_items = submission_items(config, TYPE_QUIZ, effective_quiz_items)
    available = [item["id"] for item in available_items]

    # Map item ID -> bankItemId (if any)
    bank_item_id_map = {}
    for item in available_items:
        if "bankItemId" in item and item.get("bankItemId") is not None:
            bank_item_id_map[item["id"]] = item["bankItemId"]

    available_set = set(available)
    kept = []
    for item_id in keep or []:
        if item_id in available_set and item_id not in kept:
            kept.append(item_id)

    # Calculate what needs to be drawn
    if not mix_station_quiz:
        inline_items = [item_id for item_id in available if item_id not in bank_item_id_map]
        bank_pool = [item_id for item_id in available if item_id in bank_item_id_map]

        if bank_pool:
            # Bank items configured: only the bank pool is randomized, inline
            # items are always shown in full (§2.4).
            always_shown = inline_items
            randomizable = bank_pool
        else:
            # No bank items at all — the station predates the shared bank
            # (or simply doesn't use one). Preserve the original behavior:
            # randomCount applies to the whole (inline) item list.
            always_shown = []
            randomizable = inline_items

        if not target or target >= len(randomizable):
            return _full_serve_order(available, kept)  # N=0 or >= pool size means serve all

        # Ensure always-shown items are kept.
        for item_id in always_shown:
            if item_id not in kept:
                kept.append(item_id)

        # Prune kept randomizable items if we have more than target
        current_kept_random = [k for k in kept if k in randomizable]
        if len(current_kept_random) > target:
            kept_random = current_kept_random[:target]
            kept = kept_random + always_shown
            current_kept_random = kept_random

        needed = target - len(current_kept_random)

        if needed > 0:
            pool = [pid for pid in randomizable if pid not in kept]
            seen = seen_bank_ids or set()
            unseen_pool = [pid for pid in pool if bank_item_id_map.get(pid) not in seen]
            seen_pool = [pid for pid in pool if bank_item_id_map.get(pid) in seen]

            if len(unseen_pool) >= needed:
                kept.extend(rng.sample(unseen_pool, needed))
            else:
                kept.extend(rng.sample(unseen_pool, len(unseen_pool)))
                needed -= len(unseen_pool)
                if len(seen_pool) >= needed:
                    kept.extend(rng.sample(seen_pool, needed))
                else:
                    kept.extend(rng.sample(seen_pool, len(seen_pool)))
    else:
        # mixStationQuiz = true
        if not target or target >= len(available):
            return _full_serve_order(available, kept)
            
        if len(kept) > target:
            kept = kept[:target]
        elif len(kept) < target:
            pool = [item_id for item_id in available if item_id not in kept]
            seen = seen_bank_ids or set()
            
            # For dedup, inline items (not in bank_item_id_map) are treated as unseen.
            unseen_pool = [pid for pid in pool if pid not in bank_item_id_map or bank_item_id_map.get(pid) not in seen]
            seen_pool = [pid for pid in pool if pid in bank_item_id_map and bank_item_id_map.get(pid) in seen]
            
            needed = target - len(kept)
            if len(unseen_pool) >= needed:
                kept.extend(rng.sample(unseen_pool, needed))
            else:
                kept.extend(rng.sample(unseen_pool, len(unseen_pool)))
                needed -= len(unseen_pool)
                if len(seen_pool) >= needed:
                    kept.extend(rng.sample(seen_pool, needed))
                else:
                    kept.extend(rng.sample(seen_pool, len(seen_pool)))

    order = {item_id: index for index, item_id in enumerate(available)}
    return sorted(kept, key=lambda item_id: order[item_id])


def _served_items(items: list[dict], item_ids: list[str] | None) -> list[dict]:
    """Drop quiz items outside a team's draw; other item types always stay."""
    if not item_ids:
        return items
    drawn = set(item_ids)
    return [
        item for item in items
        if item["type"] != TYPE_QUIZ or item["id"] in drawn
    ]


def public_config(
    config: dict | None,
    item_ids: list[str] | None = None,
    effective_quiz_items: list[dict] | None = None,
) -> dict:
    """Canonical config with quiz answers removed, safe to send to participants.

    Pass `item_ids` — a team's stored draw — to serve only that team's questions.
    """
    public = deepcopy(normalize_config(config))
    all_items = submission_items(config, effective_quiz_items=effective_quiz_items)
    public["items"] = _served_items(all_items, item_ids)
    
    for item in public["items"]:
        if item["type"] == TYPE_QUIZ:
            for key in _ANSWER_KEYS:
                item.pop(key, None)
    return public


def grade_quiz(
    config: dict | None,
    response_payload: dict | None,
    item_ids: list[str] | None = None,
    effective_quiz_items: list[dict] | None = None,
) -> dict | None:
    """Grade quiz answers against the config; None when the form has no quiz."""
    items = _served_items(
        submission_items(config, TYPE_QUIZ, effective_quiz_items),
        item_ids
    )
    if not items:
        return None

    answers = {}
    for answer in (response_payload or {}).get("quiz") or []:
        if isinstance(answer, dict):
            answers[str(answer.get("id"))] = answer.get("selectedOption")

    correct_count = 0
    total = 0
    points = 0
    max_points = 0
    for item in items:
        correct = item.get("correctOption")
        if not isinstance(correct, int):
            continue
        weight = item_points(item)
        total += 1
        max_points += weight
        if answers.get(str(item["id"])) == correct:
            correct_count += 1
            points += weight

    return {
        "correct_count": correct_count,
        "total": total,
        "points": points,
        "max_points": max_points,
        "all_correct": total > 0 and correct_count == total,
    }
