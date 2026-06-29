from django.urls import path

from api.views_assignment import (
    admin_station_assignment_detail_view,
    admin_station_assignments_view,
    coop_my_assignments_view,
)

urlpatterns = [
    path("coop/me/assignments", coop_my_assignments_view),
    path("coop/me/assignments/", coop_my_assignments_view),
    path("admin/station-assignments", admin_station_assignments_view),
    path("admin/station-assignments/", admin_station_assignments_view),
    path("admin/station-assignments/<int:assignment_id>", admin_station_assignment_detail_view),
    path("admin/station-assignments/<int:assignment_id>/", admin_station_assignment_detail_view),
]
