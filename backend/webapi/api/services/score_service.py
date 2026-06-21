"""
Score service — score entries, leaderboard, advancement.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from django.db.models import Sum
from django.db import transaction

from api.models import (
    Account, Team, ProgramPhase, SubEvent, PhaseRoster,
    ScoreEntry, AdvancementRule, TeamMembership,
)


def _get_phase_roster(phase: ProgramPhase):
    roster = list(
        PhaseRoster.objects.filter(phase=phase).select_related("team", "qualified_from_phase"),
    )
    return roster


def _team_scope_for_phase(phase: ProgramPhase) -> tuple[list[dict], list[int], bool]:
    roster = _get_phase_roster(phase)
    if roster:
        items = [
            {
                "team_id": entry.team_id,
                "team_code": entry.team.code,
                "team_name": entry.team.name,
                "origin": entry.origin,
                "qualified_from": entry.qualified_from_phase.key if entry.qualified_from_phase else None,
            }
            for entry in roster
        ]
        return items, [entry.team_id for entry in roster], True

    approved_teams = list(
        Team.objects.filter(approval_status=Team.APPROVAL_APPROVED).order_by("code"),
    )
    items = [
        {
            "team_id": team.id,
            "team_code": team.code,
            "team_name": team.name,
            "origin": None,
            "qualified_from": None,
        }
        for team in approved_teams
    ]
    return items, [team.id for team in approved_teams], False


def _build_team_meta_map(team_ids: list[int]) -> dict[int, dict]:
    memberships = TeamMembership.objects.filter(
        team_id__in=team_ids,
    ).select_related("participant")
    meta: dict[int, dict] = {}

    for membership in memberships:
        current = meta.setdefault(
            membership.team_id,
            {"member_count": 0, "captain_name": None},
        )
        current["member_count"] += 1
        if membership.is_captain and not current["captain_name"]:
            current["captain_name"] = membership.participant.full_name or membership.participant.mssv

    return meta


def get_phase_scoreboard(phase_key: str) -> dict:
    """Return roster, leaderboard, and event breakdown for a phase."""
    phase = ProgramPhase.objects.get(key=phase_key)
    roster_teams, team_ids, roster_is_strict = _team_scope_for_phase(phase)
    team_meta = _build_team_meta_map(team_ids)

    # Get all sub-events for this phase
    sub_events = SubEvent.objects.filter(phase=phase).order_by("order")
    next_phase = ProgramPhase.objects.filter(order__gt=phase.order).order_by("order").first()
    advancement_rule = AdvancementRule.objects.select_related(
        "to_phase", "published_by",
    ).filter(from_phase=phase).first()

    scores = ScoreEntry.objects.filter(
        phase=phase,
        team_id__in=team_ids,
    ).values("team_id", "team__code", "team__name").annotate(
        total=Sum("points"),
    )
    totals_by_team_id = {score["team_id"]: score["total"] or 0 for score in scores}
    leaderboard = sorted(
        [
            {
                "team_code": team["team_code"],
                "team_name": team["team_name"],
                "member_count": team_meta.get(team["team_id"], {}).get("member_count", 0),
                "captain_name": team_meta.get(team["team_id"], {}).get("captain_name"),
                "total_points": totals_by_team_id.get(team["team_id"], 0),
            }
            for team in roster_teams
        ],
        key=lambda item: (-item["total_points"], item["team_code"]),
    )

    # Per-event breakdown
    event_breakdown = {}
    for se in sub_events:
        event_scores = ScoreEntry.objects.filter(
            phase=phase, sub_event=se,
            team_id__in=team_ids,
        ).values("team__code").annotate(total=Sum("points")).order_by("-total", "team__code")
        event_breakdown[se.name] = [
            {"team_code": e["team__code"], "points": e["total"]}
            for e in event_scores
        ]

    entries = ScoreEntry.objects.filter(
        phase=phase,
        team_id__in=team_ids,
    ).select_related(
        "team", "sub_event", "station_session__station", "created_by",
    ).order_by("-created_at", "-id")

    detailed_roster = [
        {
            **team,
            "member_count": team_meta.get(team["team_id"], {}).get("member_count", 0),
            "captain_name": team_meta.get(team["team_id"], {}).get("captain_name"),
        }
        for team in roster_teams
    ]

    return {
        "phase_key": phase.key,
        "phase_label": phase.label,
        "roster_teams": detailed_roster,
        "roster_count": len(detailed_roster),
        "leaderboard": leaderboard,
        "event_breakdown": event_breakdown,
        "uses_phase_roster": roster_is_strict,
        "score_entries": [
            {
                "id": entry.id,
                "team_code": entry.team.code,
                "team_name": entry.team.name,
                "event_id": entry.sub_event_id,
                "event_name": entry.sub_event.name,
                "kind": entry.kind,
                "points": entry.points,
                "note": entry.note,
                "station_session_id": entry.station_session_id,
                "station_code": entry.station_session.station.code if entry.station_session else None,
                "station_name": entry.station_session.station.name if entry.station_session else None,
                "created_by": entry.created_by.username if entry.created_by else None,
                "created_at": entry.created_at.isoformat(),
                "updated_at": entry.updated_at.isoformat(),
            }
            for entry in entries
        ],
        "advancement": {
            "next_phase_key": advancement_rule.to_phase.key if advancement_rule else (next_phase.key if next_phase else None),
            "next_phase_label": advancement_rule.to_phase.label if advancement_rule else (next_phase.label if next_phase else None),
            "mode": advancement_rule.mode if advancement_rule else AdvancementRule.MODE_TOP_N,
            "slots": advancement_rule.slots if advancement_rule else 0,
            "last_published_at": advancement_rule.last_published_at.isoformat() if advancement_rule and advancement_rule.last_published_at else None,
            "published_by": advancement_rule.published_by.username if advancement_rule and advancement_rule.published_by else None,
        },
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

    if PhaseRoster.objects.filter(phase=phase).exists():
        if not PhaseRoster.objects.filter(phase=phase, team=team).exists():
            raise ValueError("team_not_in_phase")
    elif team.approval_status != Team.APPROVAL_APPROVED:
        raise ValueError("team_not_in_phase")

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
    if mode not in (AdvancementRule.MODE_TOP_N, AdvancementRule.MODE_MANUAL):
        raise ValueError("invalid_mode")
    from_phase = ProgramPhase.objects.get(key=from_phase_key)
    to_phase = ProgramPhase.objects.get(key=to_phase_key)

    rule, _ = AdvancementRule.objects.update_or_create(
        from_phase=from_phase,
        to_phase=to_phase,
        defaults={"mode": mode, "slots": slots},
    )
    return rule


def publish_advancement(
    from_phase_key: str,
    published_by: Account,
    manual_team_codes: list[str] | None = None,
) -> dict:
    """
    Publish advancement: promote top N teams from from_phase to to_phase roster.
    Returns summary of promoted teams.
    """
    from_phase = ProgramPhase.objects.get(key=from_phase_key)
    rule = AdvancementRule.objects.filter(from_phase=from_phase).first()
    if not rule:
        raise ValueError("advancement_rule_not_found")

    roster_teams, team_ids, _ = _team_scope_for_phase(from_phase)
    scores = ScoreEntry.objects.filter(
        phase=from_phase,
        team_id__in=team_ids,
    ).values("team_id").annotate(total=Sum("points"))
    totals_by_team_id = {score["team_id"]: score["total"] or 0 for score in scores}
    ranked_teams = sorted(
        [
            {
                "team_id": team["team_id"],
                "team_code": team["team_code"],
                "team_name": team["team_name"],
                "total": totals_by_team_id.get(team["team_id"], 0),
            }
            for team in roster_teams
        ],
        key=lambda item: (-item["total"], item["team_code"]),
    )

    if rule.mode == AdvancementRule.MODE_MANUAL:
        requested_codes = []
        seen_codes = set()
        for code in manual_team_codes or []:
            normalized = str(code or "").strip()
            if normalized and normalized not in seen_codes:
                requested_codes.append(normalized)
                seen_codes.add(normalized)

        if not requested_codes:
            raise ValueError("manual_team_codes_required")

        ranked_by_code = {team["team_code"]: team for team in ranked_teams}
        missing_codes = [code for code in requested_codes if code not in ranked_by_code]
        if missing_codes:
            raise ValueError("manual_team_not_in_phase")

        top_teams = [ranked_by_code[code] for code in requested_codes]
    elif rule.mode == AdvancementRule.MODE_TOP_N and rule.slots > 0:
        top_teams = ranked_teams[:rule.slots]
    else:
        top_teams = ranked_teams

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
