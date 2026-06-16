from django.urls import path
from . import views


urlpatterns = [
    path("health", views.health),
    path("auth/login", views.login),
    path("auth/me", views.me),
    path("auth/logout", views.logout),
    path("auth/register", views.register),
    path("admin/accounts", views.admin_accounts),
    path("admin/accounts/<str:username>", views.admin_account_detail),
    # Participants (support with and without trailing slash for convenience)
    path("participants", views.participants_list),
    path("participants/", views.participants_list),
    path("participants/<str:mssv>", views.participant_detail),
    path("participants/<str:mssv>/", views.participant_detail),
    # Teams
    path("teams", views.teams_list),
    path("teams/", views.teams_list),
    path("teams/<str:team_key>", views.team_detail),
    path("teams/<str:team_key>/", views.team_detail),
    # Check-in by scanning QR
    path("checkin", views.checkin_team),
    path("checkin/<str:team_key>", views.delete_checkin),
    path("checkin/<str:team_key>/", views.delete_checkin),
    path("checkins", views.list_checkedin_teams),
    path("checkins/", views.list_checkedin_teams),
    path("checkins/stats", views.checkin_stats),
    path("checkins/stats/", views.checkin_stats),
]
