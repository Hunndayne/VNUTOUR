"""Discord routes — §9.10"""

from django.urls import path
from api.views_discord import (
    discord_status_view, provisioning_queue_view,
    retry_provision_view, broadcast_create_view,
)

urlpatterns = [
    path("discord/status", discord_status_view),
    path("discord/status/", discord_status_view),
    path("discord/provisioning-queue", provisioning_queue_view),
    path("discord/provisioning-queue/", provisioning_queue_view),
    path("discord/teams/<str:team_code>/provision", retry_provision_view),
    path("discord/teams/<str:team_code>/provision/", retry_provision_view),
    path("discord/broadcasts", broadcast_create_view),
    path("discord/broadcasts/", broadcast_create_view),
]
