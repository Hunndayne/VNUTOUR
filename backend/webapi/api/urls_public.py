"""Public (unauthenticated) routes."""

from django.urls import path
from api.views_public import site_config_view

urlpatterns = [
    path("public/site-config", site_config_view),
    path("public/site-config/", site_config_view),
]
