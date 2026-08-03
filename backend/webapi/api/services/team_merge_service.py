"""Merging under-strength teams, and the captain election that follows.

A freshers' event cannot assume five friends sign up together, so teams register
short and the organisers merge them. Merging raises a question registration never
had to answer: whose captain leads the combined team? Neither original captain
has a claim on the other's members, so the merged team starts with none and
elects one by secret ballot.

Until that ballot closes the team keeps its own code as its name. Naming stays
captain-only throughout — opening it to every member while the team is leaderless
would just move the argument from the ballot to the name field.
"""

from __future__ import annotations

from collections import Counter

from django.db import transaction

from api.models import (
    CaptainVote, EventCheckIn, Participant, ScoreEntry, StationSession,
    StationSubmission, Team, TeamMembership,
)
from api.services.registration_service import get_schema


def team_size_max() -> int:
    schema = get_schema()
    return int(schema.get("team_size_max") or schema.get("team_size") or 5)


def _has_event_history(team: Team) -> bool:
    """Whether a team has done anything that merging would orphan."""
    return (
        ScoreEntry.objects.filter(team=team).exists()
        or EventCheckIn.objects.filter(team=team).exists()
        or StationSession.objects.filter(team=team).exists()
        or StationSubmission.objects.filter(team=team).exists()
    )


def can_merge(source: Team, target: Team) -> str | None:
    """Return an error code if these two teams may not be merged."""
    if source.id == target.id:
        return "merge_same_team"

    max_size = team_size_max()
    combined = (
        TeamMembership.objects.filter(team=source).count()
        + TeamMembership.objects.filter(team=target).count()
    )
    if combined > max_size:
        return f"merge_would_exceed_max:{max_size}"

    # Approved teams may be merged — they have Discord channels but no results
    # yet. Anything with results is off-limits: scores and check-ins are recorded
    # against a team code, and folding one team into another would strand them.
    for team in (source, target):
        if _has_event_history(team):
            return f"merge_team_has_history:{team.code}"

    return None


@transaction.atomic
def merge_teams(source: Team, target: Team) -> Team:
    """Move every member of `source` into `target`, then delete `source`.

    The caller is expected to have run `can_merge` first. The merged team keeps
    `target`'s code, drops both captains, resets its name to that code and opens
    a captain ballot.
    """
    # Clear both captaincies *before* moving anyone: a partial unique constraint
    # allows one captain per team, and carrying the source captain across would
    # briefly put two on the target.
    TeamMembership.objects.filter(team__in=[source, target]).update(is_captain=False)
    TeamMembership.objects.filter(team=source).update(team=target)

    # Any half-finished ballot belongs to the old shape of the team.
    CaptainVote.objects.filter(team__in=[source, target]).delete()

    source_code = source.code
    source.delete()

    # The code is the one label that is certainly still true after a merge; any
    # name either half chose belonged to a team that no longer exists.
    target.name = target.code
    target.owner_account = None
    target.save(update_fields=["name", "owner_account", "updated_at"])
    target.refresh_from_db()
    target.merged_from_code = source_code  # transient, for the caller's audit line
    return target


def has_captain(team: Team) -> bool:
    return TeamMembership.objects.filter(team=team, is_captain=True).exists()


def may_rename(team: Team, participant: Participant | None) -> bool:
    """Only the captain names the team.

    A merged team has no captain until its ballot closes, so it simply keeps its
    code as its name until then. Letting any member rename it in the meantime
    would just move the argument from the ballot to the name field.
    """
    if participant is None:
        return False
    return TeamMembership.objects.filter(
        team=team, participant=participant, is_captain=True,
    ).exists()


def cast_vote(team: Team, voter: Participant, candidate: Participant) -> str | None:
    """Record one member's ballot, replacing any earlier one. Returns an error code."""
    members = set(
        TeamMembership.objects.filter(team=team).values_list("participant_id", flat=True)
    )
    if voter.id not in members:
        return "not_a_team_member"
    if candidate.id not in members:
        return "candidate_not_in_team"
    if has_captain(team):
        return "captain_already_elected"

    CaptainVote.objects.update_or_create(
        team=team, voter=voter, defaults={"candidate": candidate},
    )
    return None


def tally(team: Team) -> dict:
    """Vote counts per candidate, plus how far along the ballot is.

    Counts only — who voted for whom never leaves this module.
    """
    votes = CaptainVote.objects.filter(team=team).values_list("candidate_id", flat=True)
    counts = Counter(votes)
    member_count = TeamMembership.objects.filter(team=team).count()
    ranked = counts.most_common()
    leaders = [pid for pid, n in ranked if ranked and n == ranked[0][1]]
    return {
        "counts": dict(counts),
        "votes_cast": len(votes),
        "member_count": member_count,
        "everyone_voted": member_count > 0 and len(votes) >= member_count,
        "leaders": leaders,
    }


def resolve_election(team: Team) -> Participant | None:
    """Promote the winner once every member has voted and one is clearly ahead.

    A tie leaves the ballot open rather than picking arbitrarily — members can
    change their vote, which is what breaks it.
    """
    if has_captain(team):
        return None
    result = tally(team)
    if not result["everyone_voted"] or len(result["leaders"]) != 1:
        return None

    winner_id = result["leaders"][0]
    TeamMembership.objects.filter(team=team).update(is_captain=False)
    TeamMembership.objects.filter(
        team=team, participant_id=winner_id,
    ).update(is_captain=True)
    CaptainVote.objects.filter(team=team).delete()

    winner = Participant.objects.filter(id=winner_id).first()
    if winner and winner.account_id:
        team.owner_account_id = winner.account_id
        team.save(update_fields=["owner_account", "updated_at"])
    return winner
