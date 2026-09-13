"""Feed / Announcement URL routes."""

from django.urls import path
from api.views_feed import (
    admin_feed_delete_comment_view,
    admin_feed_detail_update_delete_view,
    admin_feed_list_create_view,
    admin_feed_toggle_pin_view,
    admin_feed_upload_image_view,
    participant_feed_comments_view,
    participant_feed_delete_comment_view,
    participant_feed_latest_view,
    participant_feed_list_view,
    participant_feed_react_view,
)

urlpatterns = [
    # Participant Feed
    path("feed", participant_feed_list_view),
    path("feed/", participant_feed_list_view),
    path("feed/latest", participant_feed_latest_view),
    path("feed/latest/", participant_feed_latest_view),
    path("feed/<int:post_id>/react", participant_feed_react_view),
    path("feed/<int:post_id>/react/", participant_feed_react_view),
    path("feed/<int:post_id>/comments", participant_feed_comments_view),
    path("feed/<int:post_id>/comments/", participant_feed_comments_view),
    path("feed/<int:post_id>/comments/<int:comment_id>", participant_feed_delete_comment_view),
    path("feed/<int:post_id>/comments/<int:comment_id>/", participant_feed_delete_comment_view),

    # Admin Feed
    path("admin/feed", admin_feed_list_create_view),
    path("admin/feed/", admin_feed_list_create_view),
    path("admin/feed/upload-image", admin_feed_upload_image_view),
    path("admin/feed/upload-image/", admin_feed_upload_image_view),
    path("admin/feed/<int:post_id>", admin_feed_detail_update_delete_view),
    path("admin/feed/<int:post_id>/", admin_feed_detail_update_delete_view),
    path("admin/feed/<int:post_id>/pin", admin_feed_toggle_pin_view),
    path("admin/feed/<int:post_id>/pin/", admin_feed_toggle_pin_view),
    path("admin/feed/<int:post_id>/comments/<int:comment_id>", admin_feed_delete_comment_view),
    path("admin/feed/<int:post_id>/comments/<int:comment_id>/", admin_feed_delete_comment_view),
]
