"""Model-level invalidation for read-mostly configuration caches."""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from api.models import (
    ProgramPhase,
    Station,
    SubEvent,
    SystemSetting,
    Team,
    TeamMembership,
)
from api.services.read_mostly_cache import (
    schedule_program_invalidation,
    schedule_site_config_invalidation,
    schedule_station_config_invalidation,
)


_SITE_CONFIG_SETTING_KEYS = {"registration_open", "max_registrations", "antibot"}


@receiver((post_save, post_delete), sender=SystemSetting)
def invalidate_system_setting_caches(sender, instance, **kwargs):
    if instance.key in _SITE_CONFIG_SETTING_KEYS:
        schedule_site_config_invalidation()
    if instance.key == "current_sub_event_id":
        schedule_program_invalidation()


@receiver((post_save, post_delete), sender=ProgramPhase)
@receiver((post_save, post_delete), sender=SubEvent)
def invalidate_program_cache(sender, instance, **kwargs):
    schedule_program_invalidation()


@receiver((post_save, post_delete), sender=Station)
def invalidate_station_cache(sender, instance, **kwargs):
    schedule_station_config_invalidation(instance.sub_event_id)


@receiver(post_save, sender=Team)
def invalidate_site_config_for_team_save(sender, instance, created, update_fields, **kwargs):
    if created or update_fields is None or "approval_status" in update_fields:
        schedule_site_config_invalidation()


@receiver(post_delete, sender=Team)
@receiver((post_save, post_delete), sender=TeamMembership)
def invalidate_site_config_for_registration_count(sender, instance, **kwargs):
    schedule_site_config_invalidation()
