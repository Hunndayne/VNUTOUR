"""Participant self-service routes — §9.2"""

from django.urls import path
from api.views_participant import (
    me_profile_view, my_team_view, my_team_submit_view,
    my_team_members_view, my_team_member_detail_view, my_team_member_resolve_view,
    my_team_qr_view, my_team_forms_view, my_team_form_submit_view, my_experience_view,
    my_team_captain_vote_view,
)

urlpatterns = [
    path("me/profile", me_profile_view),
    path("me/profile/", me_profile_view),
    path("my-team", my_team_view),
    path("my-team/", my_team_view),
    path("my-team/submit", my_team_submit_view),
    path("my-team/submit/", my_team_submit_view),
    path("my-team/members", my_team_members_view),
    path("my-team/members/", my_team_members_view),
    path("my-team/members/resolve", my_team_member_resolve_view),
    path("my-team/members/resolve/", my_team_member_resolve_view),
    path("my-team/members/<str:mssv>", my_team_member_detail_view),
    path("my-team/members/<str:mssv>/", my_team_member_detail_view),
    path("my-team/qr", my_team_qr_view),
    path("my-team/qr/", my_team_qr_view),
    path("my-team/forms", my_team_forms_view),
    path("my-team/forms/", my_team_forms_view),
    path("my-team/forms/<int:station_id>/submit", my_team_form_submit_view),
    path("my-team/forms/<int:station_id>/submit/", my_team_form_submit_view),
    path("my-team/captain-vote", my_team_captain_vote_view),
    path("my-team/captain-vote/", my_team_captain_vote_view),
    path("me/experience", my_experience_view),
    path("me/experience/", my_experience_view),
]
