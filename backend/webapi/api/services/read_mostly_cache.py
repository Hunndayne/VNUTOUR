"""Resilient cache-aside helpers for configuration data read by many users.

PostgreSQL remains the source of truth.  Cache failures are treated as misses,
and invalidation happens only after the surrounding database transaction has
committed successfully.
"""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable, Iterable
from typing import TypeVar

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from prometheus_client import Counter, Histogram


logger = logging.getLogger(__name__)

_T = TypeVar("_T")
_CACHE_MISS = object()
_GENERATION_ERROR = object()
_KEY_PREFIX = "vnutour:read-mostly:v1"

SITE_CONFIG_KEY = f"{_KEY_PREFIX}:site-config"
PROGRAM_KEY = f"{_KEY_PREFIX}:program"

_CACHE_READS = Counter(
    "vnutour_read_mostly_cache_reads_total",
    "Read-mostly cache lookups by logical cache and result.",
    ("cache_name", "result"),
)
_CACHE_LOAD_SECONDS = Histogram(
    "vnutour_read_mostly_cache_load_seconds",
    "Time spent rebuilding a read-mostly cache value from PostgreSQL.",
    ("cache_name",),
)
_CACHE_ERRORS = Counter(
    "vnutour_read_mostly_cache_errors_total",
    "Read-mostly cache operation errors.",
    ("cache_name", "operation"),
)


def _enabled() -> bool:
    return bool(getattr(settings, "READ_MOSTLY_CACHE_ENABLED", True))


def _ttl_seconds(base_ttl: int) -> int:
    base = max(1, int(base_ttl))
    percent = max(
        0,
        min(100, int(getattr(settings, "READ_MOSTLY_CACHE_TTL_JITTER_PERCENT", 10))),
    )
    spread = int(base * percent / 100)
    if spread == 0:
        return base
    return max(1, base + random.randint(-spread, spread))


def _load(cache_name: str, loader: Callable[[], _T]) -> _T:
    with _CACHE_LOAD_SECONDS.labels(cache_name).time():
        return loader()


def _generation_key(key: str) -> str:
    return f"{key}:generation"


def _read_generation(cache_name: str, key: str):
    try:
        return cache.get(_generation_key(key), 0)
    except Exception:
        _CACHE_ERRORS.labels(cache_name, "generation_get").inc()
        logger.warning(
            "Read-mostly cache generation read failed for %s", key, exc_info=True,
        )
        return _GENERATION_ERROR


def get_or_load(
    *,
    cache_name: str,
    key: str,
    ttl_seconds: int,
    loader: Callable[[], _T],
) -> _T:
    """Return one cached value, rebuilding it safely on a miss.

    A short ``cache.add`` lock reduces dogpiles after expiry or invalidation.
    Contenders wait only for a small configured budget, then load directly from
    PostgreSQL rather than making Redis an availability dependency.
    """
    if not _enabled():
        _CACHE_READS.labels(cache_name, "bypass").inc()
        return _load(cache_name, loader)

    try:
        cached = cache.get(key, _CACHE_MISS)
    except Exception:
        _CACHE_READS.labels(cache_name, "error").inc()
        _CACHE_ERRORS.labels(cache_name, "get").inc()
        logger.warning("Read-mostly cache read failed for %s", key, exc_info=True)
        return _load(cache_name, loader)

    if cached is not _CACHE_MISS:
        _CACHE_READS.labels(cache_name, "hit").inc()
        return cached

    _CACHE_READS.labels(cache_name, "miss").inc()
    lock_key = f"{key}:rebuild-lock"
    lock_seconds = max(
        1,
        int(float(getattr(settings, "READ_MOSTLY_CACHE_LOCK_SECONDS", 5))),
    )
    try:
        owns_lock = cache.add(lock_key, True, timeout=lock_seconds)
    except Exception:
        _CACHE_ERRORS.labels(cache_name, "lock").inc()
        logger.warning("Read-mostly cache lock failed for %s", key, exc_info=True)
        return _load(cache_name, loader)

    if not owns_lock:
        wait_budget = max(
            0.0,
            float(getattr(settings, "READ_MOSTLY_CACHE_LOCK_WAIT_SECONDS", 0.1)),
        )
        deadline = time.monotonic() + wait_budget
        while time.monotonic() < deadline:
            time.sleep(min(0.025, max(0.0, deadline - time.monotonic())))
            try:
                cached = cache.get(key, _CACHE_MISS)
            except Exception:
                _CACHE_ERRORS.labels(cache_name, "wait_get").inc()
                logger.warning(
                    "Read-mostly cache wait read failed for %s", key, exc_info=True,
                )
                return _load(cache_name, loader)
            if cached is not _CACHE_MISS:
                _CACHE_READS.labels(cache_name, "coalesced_hit").inc()
                return cached

        # Do not wait indefinitely for a cache optimisation.  Loading without
        # writing also avoids competing with the request that owns the lock.
        _CACHE_READS.labels(cache_name, "lock_timeout").inc()
        return _load(cache_name, loader)

    try:
        generation_before = _read_generation(cache_name, key)
        value = _load(cache_name, loader)
        generation_after_load = _read_generation(cache_name, key)
        if (
            generation_before is _GENERATION_ERROR
            or generation_after_load is _GENERATION_ERROR
            or generation_before != generation_after_load
        ):
            # A write committed while this value was being rebuilt.  Return the
            # request's DB result but do not let it repopulate a stale cache.
            return value
        try:
            cache.set(key, value, timeout=_ttl_seconds(ttl_seconds))
            # Fence the narrow race where invalidation lands between the
            # pre-set generation check and cache.set().
            generation_after_set = _read_generation(cache_name, key)
            if (
                generation_after_set is _GENERATION_ERROR
                or generation_after_set != generation_before
            ):
                cache.delete(key)
        except Exception:
            _CACHE_ERRORS.labels(cache_name, "set").inc()
            logger.warning("Read-mostly cache write failed for %s", key, exc_info=True)
        return value
    finally:
        try:
            cache.delete(lock_key)
        except Exception:
            _CACHE_ERRORS.labels(cache_name, "unlock").inc()
            logger.warning("Read-mostly cache unlock failed for %s", key, exc_info=True)


def station_config_key(
    event_id: int,
    *,
    include_inactive: bool,
    scope: str,
) -> str:
    if scope not in {"full", "public"}:
        raise ValueError("invalid_station_cache_scope")
    return (
        f"{_KEY_PREFIX}:stations:event:{int(event_id)}:"
        f"inactive:{int(bool(include_inactive))}:scope:{scope}"
    )


def station_config_keys(event_id: int) -> tuple[str, ...]:
    return tuple(
        station_config_key(
            event_id,
            include_inactive=include_inactive,
            scope=scope,
        )
        for include_inactive in (False, True)
        for scope in ("full", "public")
    )


def _delete_keys(cache_name: str, keys: tuple[str, ...]) -> None:
    if not _enabled() or not keys:
        return
    # Increment a fencing generation before deleting values.  A concurrent miss
    # that started loading before this commit can then detect the write and must
    # not put its stale snapshot back after the delete.  A generation failure
    # must not prevent the best-effort delete itself.
    for key in keys:
        try:
            generation_key = _generation_key(key)
            if not cache.add(generation_key, 1, timeout=None):
                cache.incr(generation_key)
        except Exception:
            _CACHE_ERRORS.labels(cache_name, "generation_invalidate").inc()
            logger.warning(
                "Read-mostly cache generation invalidation failed for %s",
                key,
                exc_info=True,
            )
    try:
        cache.delete_many(keys)
    except Exception:
        _CACHE_ERRORS.labels(cache_name, "invalidate").inc()
        logger.warning(
            "Read-mostly cache invalidation failed for %s", cache_name, exc_info=True,
        )


def schedule_invalidation(cache_name: str, keys: Iterable[str]) -> None:
    frozen_keys = tuple(sorted(set(keys)))
    transaction.on_commit(lambda: _delete_keys(cache_name, frozen_keys))


def schedule_site_config_invalidation() -> None:
    schedule_invalidation("site_config", (SITE_CONFIG_KEY,))


def schedule_program_invalidation() -> None:
    schedule_invalidation("program", (PROGRAM_KEY,))


def schedule_station_config_invalidation(event_id: int) -> None:
    schedule_invalidation("station_config", station_config_keys(event_id))
