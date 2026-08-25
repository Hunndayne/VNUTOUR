"""Admin teams & accounts routes — §9.3"""

from django.urls import path
from api.views_admin import (
    teams_collection_view, team_item_view,
    team_approve_view, team_reject_view,
    admin_accounts_view, admin_account_detail_view, team_merge_view,
    admin_team_payment_proof_view, admin_payment_config_view,
    admin_site_config_view, admin_registration_schema_view,
    admin_timo_pot_config_view,
)

urlpatterns = [
    path("teams", teams_collection_view),
    path("teams/", teams_collection_view),
    path("teams/<str:team_key>", team_item_view),
    path("teams/<str:team_key>/", team_item_view),
    path("teams/<str:team_key>/approve", team_approve_view),
    path("teams/<str:team_key>/reject", team_reject_view),
    path("admin/teams/merge", team_merge_view),
    path("admin/teams/<int:team_id>/payment-proof", admin_team_payment_proof_view),
    path("admin/teams/<int:team_id>/payment-proof/", admin_team_payment_proof_view),
    path("admin/payment-config", admin_payment_config_view),
    path("admin/payment-config/", admin_payment_config_view),
    path("admin/timo-pot-config", admin_timo_pot_config_view),
    path("admin/timo-pot-config/", admin_timo_pot_config_view),
    path("admin/site-config", admin_site_config_view),
    path("admin/site-config/", admin_site_config_view),
    path("admin/registration-schema", admin_registration_schema_view),
    path("admin/registration-schema/", admin_registration_schema_view),
    path("admin/accounts", admin_accounts_view),
    path("admin/accounts/<str:username>", admin_account_detail_view),
]
