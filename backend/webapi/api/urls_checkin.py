"""Event check-in routes — §9.6 (canonical + compat aliases)"""

from django.urls import path
from api.views_checkin import (
    event_checkin_scan_view, event_checkin_list_view,
    event_checkin_stats_view, event_checkin_reset_view,
    checkin_legacy_view, checkins_legacy_list_view,
    checkins_legacy_stats_view, checkin_legacy_reset_view,
)

urlpatterns = [
    path("event-checkins/scan", event_checkin_scan_view),
    path("event-checkins/scan/", event_checkin_scan_view),
    path("event-checkins", event_checkin_list_view),
    path("event-checkins/", event_checkin_list_view),
    path("event-checkins/stats", event_checkin_stats_view),
    path("event-checkins/stats/", event_checkin_stats_view),
    path("event-checkins/<int:checkin_id>", event_checkin_reset_view),
    path("event-checkins/<int:checkin_id>/", event_checkin_reset_view),
    path("checkin", checkin_legacy_view),
    path("checkin/", checkin_legacy_view),
    path("checkins", checkins_legacy_list_view),
    path("checkins/", checkins_legacy_list_view),
    path("checkins/stats", checkins_legacy_stats_view),
    path("checkins/stats/", checkins_legacy_stats_view),
    path("checkin/<str:team_key>", checkin_legacy_reset_view),
    path("checkin/<str:team_key>/", checkin_legacy_reset_view),
]
