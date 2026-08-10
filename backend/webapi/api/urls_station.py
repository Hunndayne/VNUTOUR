"""Station routes — §9.5 + §9.7"""

from django.urls import path
from api.views_station import (
    stations_for_event_view, station_create_view,
    station_detail_view, occupancy_view,
    station_sessions_history_view,
    station_enter_view, station_exit_view, station_scan_view,
    recent_sessions_view, station_session_score_view,
    station_submissions_view, submission_grade_view,
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
    path("stations/<int:station_id>/submissions", station_submissions_view),
    path("stations/<int:station_id>/submissions/", station_submissions_view),
    path("submissions/<int:submission_id>/grade", submission_grade_view),
    path("submissions/<int:submission_id>/grade/", submission_grade_view),
    path("station-scan", station_scan_view),
    path("station-scan/", station_scan_view),
    path("station-sessions/enter", station_enter_view),
    path("station-sessions/enter/", station_enter_view),
    path("station-sessions/exit", station_exit_view),
    path("station-sessions/exit/", station_exit_view),
    path("station-sessions/<int:session_id>/score", station_session_score_view),
    path("station-sessions/<int:session_id>/score/", station_session_score_view),
    path("station-sessions", recent_sessions_view),
    path("station-sessions/", recent_sessions_view),
]
