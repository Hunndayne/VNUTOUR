"""
Score service — score entries, leaderboard, advancement.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from django.db.models import Sum, Q
from django.db import transaction

from api.models import (
    Account, Team, ProgramPhase, SubEvent, PhaseRoster,
    ScoreEntry, AdvancementRule, StationSession,
)


def get_phase_scoreboard(phase_key: str) -> dict:
    """Return roster, leaderboard, and event breakdown for a phase."""
    phase = ProgramPhase.objects.get(key=phase_key)

    # Roster
    roster = PhaseRoster.objects.filter(phase=phase).select_related("team")
    roster_teams = [
        {
            "team_code": r.team.code,
            "team_name": r.team.name,
            "origin": r.origin,
            "qualified_from": r.qualified_from_phase.key if r.qualified_from_phase else None,
        }
        for r in roster
    ]

    # Get all sub-events for this phase
    sub_events = SubEvent.objects.filter(phase=phase).order_by("order")

    # Score entries grouped by team
    scores = ScoreEntry.objects.filter(phase=phase).values("team__code", "team__name").annotate(
        total=Sum("points"),
    ).order_by("-total")

    # Per-event breakdown
    event_breakdown = {}
    for se in sub_events:
        event_scores = ScoreEntry.objects.filter(
            phase=phase, sub_event=se,
        ).values("team__code").annotate(total=Sum("points")).order_by("-total")
        event_breakdown[se.name] = [
            {"team_code": e["team__code"], "points": e["total"]}
            for e in event_scores
        ]

    return {
        "phase_key": phase.key,
        "phase_label": phase.label,
        "roster_teams": roster_teams,
        "roster_count": len(roster_teams),
        "leaderboard": [
            {"team_code": s["team__code"], "team_name": s["team__name"], "total_points": s["total"]}
            for s in scores
        ],
        "event_breakdown": event_breakdown,
    }


def create_score_entry(
    phase_key: str,
    event_id: int,
    team_code: str,
    kind: str,
    points: int,
    created_by: Account,
    note: str | None = None,
    station_session_id: int | None = None,
) -> ScoreEntry:
    """Create a manual/bonus/penalty score entry."""
    phase = ProgramPhase.objects.get(key=phase_key)
    sub_event = SubEvent.objects.get(id=event_id, phase=phase)
    team = Team.objects.get(code=team_code)

    entry = ScoreEntry.objects.create(
        phase=phase,
        sub_event=sub_event,
        team=team,
        kind=kind,
        points=_normalize_points(kind, points),
        note=note,
        created_by=created_by,
        station_session_id=station_session_id,
    )
    return entry


def _normalize_points(kind: str, points: int) -> int:
    """Penalties are always stored negative and bonuses positive so the
    leaderboard can simply Sum(points). Manual/station keep the sign as given."""
    if kind == ScoreEntry.KIND_PENALTY:
        return -abs(points)
    if kind == ScoreEntry.KIND_BONUS:
        return abs(points)
    return points


def update_score_entry(entry_id: int, points: int | None = None, note: str | None = None) -> ScoreEntry:
    """Update a score entry."""
    entry = ScoreEntry.objects.get(id=entry_id)
    if points is not None:
        entry.points = _normalize_points(entry.kind, points)
    if note is not None:
        entry.note = note
    entry.save(update_fields=["points", "note", "updated_at"])
    return entry


def delete_score_entry(entry_id: int) -> None:
    """Delete a score entry."""
    ScoreEntry.objects.filter(id=entry_id).delete()


def get_advancement_rule(from_phase_key: str, to_phase_key: str) -> Optional[AdvancementRule]:
    """Get the advancement rule between two phases."""
    return AdvancementRule.objects.filter(
        from_phase__key=from_phase_key,
        to_phase__key=to_phase_key,
    ).first()


def set_advancement_rule(
    from_phase_key: str,
    to_phase_key: str,
    mode: str = AdvancementRule.MODE_TOP_N,
    slots: int = 0,
) -> AdvancementRule:
    """Create or update an advancement rule."""
    from_phase = ProgramPhase.objects.get(key=from_phase_key)
    to_phase = ProgramPhase.objects.get(key=to_phase_key)

    rule, _ = AdvancementRule.objects.update_or_create(
        from_phase=from_phase,
        to_phase=to_phase,
        defaults={"mode": mode, "slots": slots},
    )
    return rule


def publish_advancement(from_phase_key: str, published_by: Account) -> dict:
    """
    Publish advancement: promote top N teams from from_phase to to_phase roster.
    Returns summary of promoted teams.
    """
    from_phase = ProgramPhase.objects.get(key=from_phase_key)
    rule = AdvancementRule.objects.filter(from_phase=from_phase).first()
    if not rule:
        raise ValueError("advancement_rule_not_found")

    # Get leaderboard
    scores = ScoreEntry.objects.filter(phase=from_phase).values(
        "team_id", "team__code",
    ).annotate(total=Sum("points")).order_by("-total")

    if rule.mode == AdvancementRule.MODE_TOP_N and rule.slots > 0:
        top_teams = scores[:rule.slots]
    else:
        top_teams = list(scores)

    promoted = []
    now = datetime.now(timezone.utc)
    with transaction.atomic():
        for entry in top_teams:
            team = Team.objects.get(id=entry["team_id"])
            roster_entry, created = PhaseRoster.objects.update_or_create(
                phase=rule.to_phase,
                team=team,
                defaults={
                    "origin": PhaseRoster.ORIGIN_QUALIFIED,
                    "qualified_from_phase": from_phase,
                },
            )
            promoted.append({
                "team_code": team.code,
                "team_name": team.name,
                "total_points": entry["total"],
                "new_to_roster": created,
            })

        # Mark rule as published
        rule.last_published_at = now
        rule.published_by = published_by
        rule.save(update_fields=["last_published_at", "published_by", "updated_at"])

    return {
        "from_phase": from_phase.key,
        "to_phase": rule.to_phase.key,
        "mode": rule.mode,
        "slots": rule.slots,
        "promoted_count": len(promoted),
        "promoted_teams": promoted,
    }
