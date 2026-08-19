"""Short-link admin routes. The public redirect lives outside this router,
registered directly in serverapi/urls.py at `/s/<code>`."""

from django.urls import path

from api.views_shortlink import (
    admin_short_links_view, admin_short_link_detail_view,
)

urlpatterns = [
    path("admin/short-links", admin_short_links_view),
    path("admin/short-links/", admin_short_links_view),
    path("admin/short-links/<int:link_id>", admin_short_link_detail_view),
    path("admin/short-links/<int:link_id>/", admin_short_link_detail_view),
]
