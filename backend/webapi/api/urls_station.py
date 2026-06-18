"""Station routes — §9.5 + §9.7"""

from django.urls import path
from api.views_station import (
    stations_for_event_view, station_create_view,
    station_detail_view, occupancy_view,
    station_sessions_history_view,
    station_enter_view, station_exit_view,
    recent_sessions_view,
)

urlpatterns = [
    path("program/phases/<str:phase_key>/sub-events/<int:event_id>/stations", stations_for_event_view),
    path("program/phases/<str:phase_key>/sub-events/<int:event_id>/stations/", stations_for_event_view),
    path("sub-events/<int:event_id>/stations", station_create_view),
    path("sub-events/<int:event_id>/stations/", station_create_view),
    path("stations/<int:station_id>", station_detail_view),
    path("stations/<int:station_id>/", station_detail_view),
    path("stations/<int:station_id>/occupancy", occupancy_view),
    path("stations/<int:station_id>/occupancy/", occupancy_view),
    path("stations/<int:station_id>/sessions", station_sessions_history_view),
    path("stations/<int:station_id>/sessions/", station_sessions_history_view),
    path("station-sessions/enter", station_enter_view),
    path("station-sessions/enter/", station_enter_view),
    path("station-sessions/exit", station_exit_view),
    path("station-sessions/exit/", station_exit_view),
    path("station-sessions", recent_sessions_view),
    path("station-sessions/", recent_sessions_view),
]
