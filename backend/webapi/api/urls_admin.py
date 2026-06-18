"""Admin teams & accounts routes — §9.3"""

from django.urls import path
from api.views_admin import (
    teams_collection_view, team_item_view,
    team_approve_view, team_reject_view,
    admin_accounts_view, admin_account_detail_view,
)

urlpatterns = [
    path("teams", teams_collection_view),
    path("teams/", teams_collection_view),
    path("teams/<str:team_key>", team_item_view),
    path("teams/<str:team_key>/", team_item_view),
    path("teams/<str:team_key>/approve", team_approve_view),
    path("teams/<str:team_key>/reject", team_reject_view),
    path("admin/accounts", admin_accounts_view),
    path("admin/accounts/<str:username>", admin_account_detail_view),
]
