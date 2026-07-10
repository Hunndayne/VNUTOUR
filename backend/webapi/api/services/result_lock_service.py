"""Helpers for the final results lock."""

from __future__ import annotations

from api.models import ProgramPhase


RESULTS_LOCK_PHASE_KEY = "ended"


def results_are_locked() -> bool:
    """Results are locked once the current program phase is the closing phase."""
    return ProgramPhase.objects.filter(
        key=RESULTS_LOCK_PHASE_KEY,
        is_current=True,
    ).exists()


def ensure_results_unlocked() -> None:
    if results_are_locked():
        raise ValueError("results_locked")


def score_source_phase_for(phase: ProgramPhase) -> ProgramPhase:
    """The closing phase summarizes the latest real scoring phase before it."""
    if phase.key != RESULTS_LOCK_PHASE_KEY:
        return phase
    return (
        ProgramPhase.objects.filter(order__lt=phase.order).order_by("-order").first()
        or phase
    )
