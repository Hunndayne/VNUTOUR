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
from api.services.submission_config_service import draw_quiz_item_ids, random_count, quiz_item_ids
from api.services.question_bank_service import bank_item_id_of, effective_quiz_items
from api.models import Team


def variant_item_ids(station, team) -> list[str]:
    """Quiz ids this team is served, drawing and storing them on first access."""
    if team is None:
        return []

    effective_items = effective_quiz_items(station)
    available_ids = [item["id"] for item in effective_items if item["type"] == "quiz"]
    
    if not available_ids:
        # no quiz at all (bank or inline)
        return []

    # Check if we already have a materialized variant
    existing = TeamFormVariant.objects.filter(team=team, station=station).first()
    if existing:
        kept = existing.item_ids if isinstance(existing.item_ids, list) else []
        drawn = draw_quiz_item_ids(
            config=station.submission_config,
            rng=random.SystemRandom(),
            keep=kept,
            effective_quiz_items=effective_items,
            seen_bank_ids=set()  # Already drawn, no dedup applied on replay
        )
        target = random_count(station.submission_config)
        if target != 0 and len(drawn) >= len(available_ids):
            # The bank shrank at or below the configured randomCount, so
            # there is nothing left to filter — fall back to "no filtering"
            # (the documented meaning of an empty draw) instead of pinning a
            # now-meaningless stale variant row.
            existing.delete()
            return []

        if drawn != kept:
            existing.item_ids = drawn
            existing.save(update_fields=["item_ids", "updated_at"])
        return existing.item_ids

    # Serialize allocation per-team
    with transaction.atomic():
        # Lock the team to prevent cross-station race conditions
        _ = Team.objects.select_for_update().get(id=team.id)
        
        # Double check after lock
        existing = TeamFormVariant.objects.filter(team=team, station=station).first()
        if existing:
            return existing.item_ids
            
        # Read other variants in the SAME SubEvent to find seen_bank_ids
        other_variants = TeamFormVariant.objects.filter(
            team=team, 
            station__sub_event=station.sub_event
        ).exclude(station=station)
        
        seen_bank_ids = set()
        for v in other_variants:
            for iid in (v.item_ids if isinstance(v.item_ids, list) else []):
                bank_id = bank_item_id_of(iid)
                if bank_id is not None:
                    seen_bank_ids.add(bank_id)

        target = random_count(station.submission_config)
        if target == 0:
            # Materialize all available, but still apply soft dedup: drop bank
            # items the team has already seen elsewhere unless that would
            # empty out this station's whole bank pool (never serve zero
            # questions just because the pool is exhausted — repeat instead).
            bank_item_id_map = {
                item["id"]: item["bankItemId"]
                for item in effective_items
                if item.get("bankItemId") is not None
            }
            bank_ids = [item_id for item_id in available_ids if item_id in bank_item_id_map]
            unseen_bank_ids = [
                item_id for item_id in bank_ids
                if bank_item_id_map[item_id] not in seen_bank_ids
            ]
            keep_bank_ids = set(unseen_bank_ids) if unseen_bank_ids or not bank_ids else set(bank_ids)
            drawn = [
                item_id for item_id in available_ids
                if item_id not in bank_item_id_map or item_id in keep_bank_ids
            ]
        else:
            drawn = draw_quiz_item_ids(
                config=station.submission_config,
                rng=random.SystemRandom(),
                keep=[],
                effective_quiz_items=effective_items,
                seen_bank_ids=seen_bank_ids
            )
            
        try:
            TeamFormVariant.objects.create(team=team, station=station, item_ids=drawn)
        except IntegrityError:
            # Fallback if somehow race happened despite lock
            raced = TeamFormVariant.objects.filter(team=team, station=station).first()
            if raced:
                return raced.item_ids
                
        return drawn
