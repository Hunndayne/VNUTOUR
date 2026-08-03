from django.contrib import admin
from django.urls import path, include, re_path

from api.views_media import submission_media_view


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("api.urls")),
    # Local-storage submission files (R2 files are served from the bucket).
    # Behind an auth + ownership check: these are participants' uploads, and
    # `django.views.static.serve` would hand them to anyone with the URL.
    re_path(r"^media/(?P<path>.*)$", submission_media_view),
]

