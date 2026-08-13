"""Photo-frame overlay routes — public gallery/downloads + admin CRUD."""

from django.urls import path
from api.views_frame import (
    public_frames_view, public_frame_image_view, public_frame_download_view,
    admin_frames_view, admin_frame_detail_view, admin_frame_downloads_view,
)

urlpatterns = [
    # Public
    path("public/frames", public_frames_view),
    path("public/frames/", public_frames_view),
    path("public/frames/<int:frame_id>/image", public_frame_image_view),
    path("public/frames/<int:frame_id>/image/", public_frame_image_view),
    path("public/frames/<int:frame_id>/download", public_frame_download_view),
    path("public/frames/<int:frame_id>/download/", public_frame_download_view),

    # Admin — "downloads" must be registered before the <int:frame_id> catch-all
    # or it would be parsed as a frame id.
    path("admin/frames/downloads", admin_frame_downloads_view),
    path("admin/frames/downloads/", admin_frame_downloads_view),
    path("admin/frames", admin_frames_view),
    path("admin/frames/", admin_frames_view),
    path("admin/frames/<int:frame_id>", admin_frame_detail_view),
    path("admin/frames/<int:frame_id>/", admin_frame_detail_view),
]
