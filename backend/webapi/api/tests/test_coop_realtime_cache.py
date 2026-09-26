from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings

from api.services.coop_realtime_cache import (
    checkin_stats_key,
    get_or_load,
    occupancy_key,
    recent_sessions_key,
    schedule_checkin_invalidation,
    schedule_station_invalidation,
    station_sessions_key,
)


LOC_MEMORY_CACHE = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "coop-realtime-tests",
    },
}


@override_settings(
    CACHES=LOC_MEMORY_CACHE,
    COOP_REALTIME_CACHE_ENABLED=True,
    COOP_REALTIME_CACHE_TTL_MIN_SECONDS=2,
    COOP_REALTIME_CACHE_TTL_MAX_SECONDS=5,
)
class CoopRealtimeCacheTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    @patch("api.services.coop_realtime_cache.random.randint", return_value=4)
    def test_repeated_read_uses_cached_value(self, jitter):
        loader = Mock(return_value={"active_sessions": 2})
        key = occupancy_key(7)

        first = get_or_load(key, loader)
        second = get_or_load(key, loader)

        self.assertEqual(first, {"active_sessions": 2})
        self.assertEqual(second, first)
        loader.assert_called_once_with()
        jitter.assert_called_once_with(2, 5)

    def test_keys_are_isolated_by_event_and_station(self):
        self.assertNotEqual(
            checkin_stats_key(1, "qualifying"),
            checkin_stats_key(2, "qualifying"),
        )
        self.assertNotEqual(occupancy_key(3), occupancy_key(4))
        self.assertNotEqual(recent_sessions_key(1), recent_sessions_key(2))
        self.assertNotEqual(station_sessions_key(3), station_sessions_key(4))

    @patch("api.services.coop_realtime_cache.cache.get", side_effect=ConnectionError("redis down"))
    def test_cache_read_failure_falls_back_to_loader(self, _cache_get):
        loader = Mock(return_value={"sessions": []})

        self.assertEqual(get_or_load(recent_sessions_key(9), loader), {"sessions": []})
        loader.assert_called_once_with()

    @patch("api.services.coop_realtime_cache.cache.set", side_effect=ConnectionError("redis down"))
    def test_cache_write_failure_does_not_fail_request(self, _cache_set):
        loader = Mock(return_value={"checked_in_teams": 12})

        result = get_or_load(checkin_stats_key(9, "qualifying"), loader)

        self.assertEqual(result, {"checked_in_teams": 12})


@override_settings(CACHES=LOC_MEMORY_CACHE, COOP_REALTIME_CACHE_ENABLED=True)
class CoopRealtimeInvalidationTests(TestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_station_keys_are_deleted_only_after_commit(self):
        keys = (
            recent_sessions_key(11),
            occupancy_key(21),
            station_sessions_key(21),
        )
        for key in keys:
            cache.set(key, {"cached": True}, timeout=60)

        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            schedule_station_invalidation(11, 21)
            self.assertTrue(all(cache.get(key) is not None for key in keys))

        self.assertEqual(len(callbacks), 1)
        self.assertTrue(all(cache.get(key) is None for key in keys))

    def test_checkin_invalidation_covers_event_phase_and_global_variants(self):
        keys = (
            checkin_stats_key(11, "qualifying"),
            checkin_stats_key(11, None),
            checkin_stats_key(None, "qualifying"),
            checkin_stats_key(None, None),
        )
        for key in keys:
            cache.set(key, {"cached": True}, timeout=60)

        with self.captureOnCommitCallbacks(execute=True):
            schedule_checkin_invalidation(11, "qualifying")

        self.assertTrue(all(cache.get(key) is None for key in keys))

