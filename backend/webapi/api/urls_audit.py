from django.urls import path

from api.views_audit import audit_logs_view, audit_undo_view


urlpatterns = [
    path("admin/audit-logs", audit_logs_view),
    path("admin/audit-logs/", audit_logs_view),
    path("admin/audit-logs/<int:audit_id>/undo", audit_undo_view),
    path("admin/audit-logs/<int:audit_id>/undo/", audit_undo_view),
]
