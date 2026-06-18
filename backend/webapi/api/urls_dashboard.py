"""Dashboard, settings, health routes — §9.11"""

from django.urls import path
from api.views_dashboard import (
    health, overview_view, activity_view, settings_view,
)

urlpatterns = [
    path("health", health),
    path("dashboard/overview", overview_view),
    path("dashboard/overview/", overview_view),
    path("activity", activity_view),
    path("activity/", activity_view),
    path("settings", settings_view),
    path("settings/", settings_view),
]
