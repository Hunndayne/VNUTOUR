"""Short-lived shared cache for the Coop dashboard's polled data.

The dashboard is intentionally only a few seconds behind the database.  Cache
entries therefore have a small jittered TTL, while successful writes evict the
affected keys after their database transaction commits.
"""

from __future__ import annotations

import logging
import random
from collections.abc import Callable
from typing import TypeVar

from django.conf import settings
from django.core.cache import cache
from django.db import transaction


logger = logging.getLogger(__name__)

_T = TypeVar("_T")
_CACHE_MISS = object()
_KEY_PREFIX = "vnutour:coop-live:v1"
DEFAULT_SESSION_LIMIT = 50


def _cache_enabled() -> bool:
    return bool(getattr(settings, "COOP_REALTIME_CACHE_ENABLED", True))


def _ttl_seconds() -> int:
    minimum = max(1, int(getattr(settings, "COOP_REALTIME_CACHE_TTL_MIN_SECONDS", 2)))
    maximum = max(minimum, int(getattr(settings, "COOP_REALTIME_CACHE_TTL_MAX_SECONDS", 5)))
    return random.randint(minimum, maximum)


def checkin_stats_key(event_id: int | None, phase_key: str | None) -> str:
    return f"{_KEY_PREFIX}:checkin-stats:event:{event_id or 'all'}:phase:{phase_key or 'all'}"


def recent_sessions_key(event_id: int) -> str:
    return f"{_KEY_PREFIX}:recent-sessions:event:{int(event_id)}"


def occupancy_key(station_id: int) -> str:
    return f"{_KEY_PREFIX}:occupancy:station:{int(station_id)}"


def station_sessions_key(station_id: int) -> str:
    return f"{_KEY_PREFIX}:station-sessions:station:{int(station_id)}"


def get_or_load(key: str, loader: Callable[[], _T]) -> _T:
    """Return a cached value, falling back to the database if cache is down."""
    if not _cache_enabled():
        return loader()

    try:
        cached = cache.get(key, _CACHE_MISS)
    except Exception:
        logger.warning("Coop realtime cache read failed for %s", key, exc_info=True)
        return loader()

    if cached is not _CACHE_MISS:
        return cached

    value = loader()
    try:
        cache.set(key, value, timeout=_ttl_seconds())
    except Exception:
        # Realtime cache is an optimisation, never an availability dependency.
        logger.warning("Coop realtime cache write failed for %s", key, exc_info=True)
    return value


def _delete_keys(keys: tuple[str, ...]) -> None:
    if not _cache_enabled() or not keys:
        return
    try:
        cache.delete_many(keys)
    except Exception:
        logger.warning("Coop realtime cache invalidation failed", exc_info=True)


def _schedule_delete(keys: set[str]) -> None:
    frozen_keys = tuple(sorted(keys))
    transaction.on_commit(lambda: _delete_keys(frozen_keys))


def schedule_checkin_invalidation(event_id: int, phase_key: str) -> None:
    """Evict every supported stats view of one event after commit."""
    _schedule_delete({
        checkin_stats_key(event_id, phase_key),
        checkin_stats_key(event_id, None),
        checkin_stats_key(None, phase_key),
        checkin_stats_key(None, None),
    })


def schedule_station_invalidation(event_id: int, station_id: int) -> None:
    """Evict event and station session data affected by a station write."""
    _schedule_delete({
        recent_sessions_key(event_id),
        occupancy_key(station_id),
        station_sessions_key(station_id),
    })

