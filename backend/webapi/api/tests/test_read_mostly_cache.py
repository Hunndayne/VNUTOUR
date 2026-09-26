from unittest.mock import Mock, patch

from django.core.cache import cache
from django.db import transaction
from django.test import SimpleTestCase, TestCase, override_settings

from api.models import ProgramPhase, Station, SubEvent, SystemSetting
from api.services.read_mostly_cache import (
    PROGRAM_KEY,
    SITE_CONFIG_KEY,
    get_or_load,
    schedule_program_invalidation,
    station_config_key,
    station_config_keys,
)
from api.services.question_bank_service import import_questions


LOC_MEMORY_CACHE = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "read-mostly-tests",
    },
}


@override_settings(
    CACHES=LOC_MEMORY_CACHE,
    READ_MOSTLY_CACHE_ENABLED=True,
    READ_MOSTLY_CACHE_TTL_JITTER_PERCENT=0,
    READ_MOSTLY_CACHE_LOCK_WAIT_SECONDS=0,
)
class ReadMostlyCacheTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_repeated_read_uses_cached_payload(self):
        loader = Mock(return_value={"phases": [1]})

        first = get_or_load(
            cache_name="program",
            key=PROGRAM_KEY,
            ttl_seconds=60,
            loader=loader,
        )
        second = get_or_load(
            cache_name="program",
            key=PROGRAM_KEY,
            ttl_seconds=60,
            loader=loader,
        )

        self.assertEqual(first, {"phases": [1]})
        self.assertEqual(second, first)
        loader.assert_called_once_with()

    @override_settings(READ_MOSTLY_CACHE_ENABLED=False)
    def test_disabled_cache_always_uses_loader(self):
        loader = Mock(side_effect=({"revision": 1}, {"revision": 2}))

        first = get_or_load(
            cache_name="program", key=PROGRAM_KEY, ttl_seconds=60, loader=loader,
        )
        second = get_or_load(
            cache_name="program", key=PROGRAM_KEY, ttl_seconds=60, loader=loader,
        )

        self.assertEqual(first["revision"], 1)
        self.assertEqual(second["revision"], 2)

    @patch(
        "api.services.read_mostly_cache.cache.get",
        side_effect=ConnectionError("redis down"),
    )
    def test_redis_read_failure_falls_back_to_loader(self, _cache_get):
        loader = Mock(return_value={"allow_signup": True})

        value = get_or_load(
            cache_name="site_config",
            key=SITE_CONFIG_KEY,
            ttl_seconds=30,
            loader=loader,
        )

        self.assertEqual(value, {"allow_signup": True})
        loader.assert_called_once_with()

    def test_station_keys_separate_visibility_and_inactive_variants(self):
        keys = station_config_keys(12)

        self.assertEqual(len(keys), 4)
        self.assertEqual(len(set(keys)), 4)
        self.assertNotEqual(
            station_config_key(12, include_inactive=False, scope="full"),
            station_config_key(12, include_inactive=False, scope="public"),
        )
        self.assertNotEqual(
            station_config_key(12, include_inactive=False, scope="full"),
            station_config_key(13, include_inactive=False, scope="full"),
        )

    @patch(
        "api.services.read_mostly_cache._read_generation",
        side_effect=(0, 1),
    )
    def test_write_during_rebuild_does_not_cache_stale_snapshot(self, _generation):
        value = get_or_load(
            cache_name="program",
            key=PROGRAM_KEY,
            ttl_seconds=60,
            loader=lambda: {"revision": "before-write"},
        )

        self.assertEqual(value, {"revision": "before-write"})
        self.assertIsNone(cache.get(PROGRAM_KEY))

    @patch(
        "api.services.read_mostly_cache._read_generation",
        side_effect=(0, 0, 1),
    )
    def test_write_racing_cache_set_removes_stale_snapshot(self, _generation):
        value = get_or_load(
            cache_name="program",
            key=PROGRAM_KEY,
            ttl_seconds=60,
            loader=lambda: {"revision": "before-write"},
        )

        self.assertEqual(value, {"revision": "before-write"})
        self.assertIsNone(cache.get(PROGRAM_KEY))


@override_settings(
    CACHES=LOC_MEMORY_CACHE,
    READ_MOSTLY_CACHE_ENABLED=True,
    READ_MOSTLY_CACHE_TTL_JITTER_PERCENT=0,
)
class ReadMostlyEndpointTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    @patch("api.views_public._load_site_config")
    def test_public_site_config_reuses_warm_payload(self, loader):
        loader.return_value = {
            "allow_signup": True,
            "registration_full": False,
            "registration_slots_remaining": 10,
            "antibot": {"enabled": False, "site_key": ""},
            "photo_gallery": False,
        }

        first = self.client.get("/api/public/site-config")
        second = self.client.get("/api/public/site-config")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.json(), first.json())
        loader.assert_called_once_with()


@override_settings(
    CACHES=LOC_MEMORY_CACHE,
    READ_MOSTLY_CACHE_ENABLED=True,
    READ_MOSTLY_CACHE_TTL_JITTER_PERCENT=0,
)
class ReadMostlyInvalidationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.phase = ProgramPhase.objects.create(key="qualifying", label="Qualifying")
        self.event = SubEvent.objects.create(phase=self.phase, name="Race")
        self.station = Station.objects.create(
            sub_event=self.event, code="S1", name="Station 1",
        )

    def tearDown(self):
        cache.clear()

    def test_scheduled_invalidation_runs_only_after_commit(self):
        cache.set(PROGRAM_KEY, {"cached": True}, timeout=60)

        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            schedule_program_invalidation()
            self.assertIsNotNone(cache.get(PROGRAM_KEY))

        self.assertEqual(len(callbacks), 1)
        self.assertIsNone(cache.get(PROGRAM_KEY))

    def test_rolled_back_write_keeps_existing_cache(self):
        cache.set(PROGRAM_KEY, {"cached": True}, timeout=60)

        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            try:
                with transaction.atomic():
                    SystemSetting.objects.create(key="current_sub_event_id", value=999)
                    raise RuntimeError("rollback")
            except RuntimeError:
                pass

        self.assertEqual(callbacks, [])
        self.assertEqual(cache.get(PROGRAM_KEY), {"cached": True})

    def test_station_save_invalidates_every_response_variant(self):
        keys = station_config_keys(self.event.id)
        for key in keys:
            cache.set(key, {"cached": True}, timeout=60)

        with self.captureOnCommitCallbacks(execute=True):
            self.station.name = "Updated"
            self.station.save(update_fields=["name", "updated_at"])

        self.assertTrue(all(cache.get(key) is None for key in keys))

    def test_relevant_system_setting_invalidates_site_config(self):
        cache.set(SITE_CONFIG_KEY, {"cached": True}, timeout=60)

        with self.captureOnCommitCallbacks(execute=True):
            SystemSetting.objects.create(key="registration_open", value=True)

        self.assertIsNone(cache.get(SITE_CONFIG_KEY))

    def test_bulk_question_import_invalidates_station_variants(self):
        keys = station_config_keys(self.event.id)
        for key in keys:
            cache.set(key, {"cached": True}, timeout=60)

        with self.captureOnCommitCallbacks(execute=True):
            import_questions(
                self.event.id,
                [{
                    "question": "2 + 2?",
                    "options": ["3", "4"],
                    "correctOption": 1,
                }],
            )

        self.assertTrue(all(cache.get(key) is None for key in keys))
