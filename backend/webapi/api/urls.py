from django.urls import path
from . import views


urlpatterns = [
    path("health", views.health),
    path("auth/login", views.login),
    path("auth/me", views.me),
    path("auth/logout", views.logout),
    path("auth/register", views.register),
    path("auth/signup", views.signup),  # self-registration (members & captains)
    path("auth/google", views.google_login),  # Google Identity Services sign-in
    path("admin/accounts", views.admin_accounts),
    path("admin/accounts/<str:username>", views.admin_account_detail),
    # System settings
    path("settings", views.settings_view),
    path("settings/", views.settings_view),
    # Logged-in member's own profile
    path("me/profile", views.me_profile),
    path("me/profile/", views.me_profile),
    # Captain self-service team management
    path("my-team", views.my_team),
    path("my-team/", views.my_team),
    path("my-team/submit", views.my_team_submit),
    path("my-team/submit/", views.my_team_submit),
    path("my-team/members", views.my_team_members),
    path("my-team/members/", views.my_team_members),
    path("my-team/members/<str:mssv>", views.my_team_member_detail),
    path("my-team/members/<str:mssv>/", views.my_team_member_detail),
    # Participants (support with and without trailing slash for convenience)
    path("participants", views.participants_collection),
    path("participants/", views.participants_collection),
    path("participants/<str:mssv>", views.participant_item),
    path("participants/<str:mssv>/", views.participant_item),
    # Teams
    path("teams", views.teams_collection),
    path("teams/", views.teams_collection),
    path("teams/<str:team_key>", views.team_item),
    path("teams/<str:team_key>/", views.team_item),
    # Team approval (admin)
    path("teams/<str:team_key>/approve", views.team_approve),
    path("teams/<str:team_key>/reject", views.team_reject),
    # Check-in by scanning QR
    path("checkin", views.checkin_team),
    path("checkin/<str:team_key>", views.delete_checkin),
    path("checkin/<str:team_key>/", views.delete_checkin),
    path("checkins", views.list_checkedin_teams),
    path("checkins/", views.list_checkedin_teams),
    path("checkins/stats", views.checkin_stats),
    path("checkins/stats/", views.checkin_stats),
]
