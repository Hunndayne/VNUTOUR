"""Public registration routes."""

from django.urls import path
from api.views_register import (
    schema_view, register_individual_view, register_team_view, lookup_view,
)

urlpatterns = [
    path("register/schema", schema_view),
    path("register/schema/", schema_view),
    path("register/individual", register_individual_view),
    path("register/individual/", register_individual_view),
    path("register/team", register_team_view),
    path("register/team/", register_team_view),
    path("register/lookup", lookup_view),
    path("register/lookup/", lookup_view),
]
