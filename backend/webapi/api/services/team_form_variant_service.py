"""Per-team question draw for stations that serve a random subset of their bank.

A station can be set to hand out, say, 5 of its 20 quiz questions
(`submission_config.quiz.randomCount`). The draw has to be a property of the
*team*, not of the request: two teammates on two phones must answer the same 5
questions, and refreshing must not deal a new hand. So the first read draws and
stores the ids in `TeamFormVariant`; every later read replays that row.

`variant_item_ids` is the only entry point. It returns [] when the station serves
its whole bank, which every caller treats as "no filtering".
"""

from __future__ import annotations

import random

from django.db import IntegrityError, transaction

from api.models import TeamFormVariant
from api.services.submission_config_service import draw_quiz_item_ids, random_count


def variant_item_ids(station, team) -> list[str]:
    """Quiz ids this team is served, drawing and storing them on first access.

    Returns [] when the station serves every question, so callers can pass the
    result straight through without special-casing.

    Switching `randomCount` back to 0 leaves any stored draw alone rather than
    spending a query per station to clear it — the read loop walks every station
    on the roster. A row kept that way is inert, and turning randomisation on
    again hands the team back the questions it already had.
    """
    if team is None or not random_count(station.submission_config):
        return []

    rng = random.SystemRandom()
    existing = TeamFormVariant.objects.filter(team=team, station=station).first()
    kept = existing.item_ids if existing and isinstance(existing.item_ids, list) else []
    drawn = draw_quiz_item_ids(station.submission_config, rng, keep=kept)

    if not drawn:
        # The bank shrank to at most the target, so everyone gets all of it now.
        # Drop the row: it describes a draw that no longer means anything.
        if existing:
            existing.delete()
        return []

    if existing:
        if existing.item_ids != drawn:
            existing.item_ids = drawn
            existing.save(update_fields=["item_ids", "updated_at"])
        return drawn

    try:
        with transaction.atomic():
            TeamFormVariant.objects.create(team=team, station=station, item_ids=drawn)
    except IntegrityError:
        # Two teammates opened the form at once; the row that landed first wins,
        # so both of them end up looking at the same questions.
        raced = TeamFormVariant.objects.filter(team=team, station=station).first()
        if raced:
            return raced.item_ids
    return drawn
