from django.urls import path

from . import views


urlpatterns = [
    path("photo-albums", views.public_albums_view),
    path("photo-albums/<int:album_id>/photos", views.public_photos_view),
    path("photo-search", views.search_create_view),
    path("photo-search/<uuid:token>", views.search_page_view),
    path("admin/photo-albums", views.admin_albums_view),
    path("admin/photo-albums/<int:album_id>", views.admin_album_detail_view),
    path("admin/photo-albums/<int:album_id>/import-drive", views.admin_import_view),
    path("admin/photo-albums/<int:album_id>/photos", views.admin_photos_view),
    path("admin/photo-albums/<int:album_id>/retry", views.admin_album_retry_view),
    path("admin/photos/<int:photo_id>/retry", views.admin_photo_retry_view),
    path("admin/photos/<int:photo_id>", views.admin_photo_remove_view),
]
