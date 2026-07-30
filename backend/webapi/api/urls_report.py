from django.urls import path

from api.views_report import report_export_view


urlpatterns = [
    path("admin/reports/export.xlsx", report_export_view),
]
