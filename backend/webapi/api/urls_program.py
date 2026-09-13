"""Program & sub-event routes — §9.4"""

from django.urls import path
from api.views_program import (
    program_view, current_phase_view, phase_detail_view,
    sub_event_create_view, sub_event_detail_view, current_sub_event_view,
    question_bank_view, question_bank_item_view
)

urlpatterns = [
    path("program", program_view),
    path("program/", program_view),
    path("program/current-phase", current_phase_view),
    path("program/current-phase/", current_phase_view),
    path("program/current-sub-event", current_sub_event_view),
    path("program/current-sub-event/", current_sub_event_view),
    path("program/phases/<str:phase_key>", phase_detail_view),
    path("program/phases/<str:phase_key>/", phase_detail_view),
    path("program/phases/<str:phase_key>/sub-events", sub_event_create_view),
    path("program/phases/<str:phase_key>/sub-events/", sub_event_create_view),
    path("program/sub-events/<int:event_id>", sub_event_detail_view),
    path("program/sub-events/<int:event_id>/", sub_event_detail_view),
    path("program/sub-events/<int:event_id>/question-bank", question_bank_view),
    path("program/sub-events/<int:event_id>/question-bank/", question_bank_view),
    path("program/sub-events/<int:event_id>/question-bank/<int:item_id>", question_bank_item_view),
    path("program/sub-events/<int:event_id>/question-bank/<int:item_id>/", question_bank_item_view),
]
