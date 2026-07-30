from django.urls import path

from api.views_backup import (
    backup_download_view,
    backup_restore_view,
    backups_view,
)


urlpatterns = [
    path("admin/backups", backups_view),
    path("admin/backups/", backups_view),
    path("admin/backups/restore", backup_restore_view),
    path("admin/backups/restore/", backup_restore_view),
    path("admin/backups/<str:filename>", backup_download_view),
]
