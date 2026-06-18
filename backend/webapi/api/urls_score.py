"""Score & advancement routes — §9.8"""

from django.urls import path
from api.views_score import (
    phase_scoreboard_view, score_entry_create_view,
    score_entry_detail_view, advancement_rule_view,
    publish_advancement_view,
)

urlpatterns = [
    path("scores/phases/<str:phase_key>", phase_scoreboard_view),
    path("scores/phases/<str:phase_key>/", phase_scoreboard_view),
    path("scores/entries", score_entry_create_view),
    path("scores/entries/", score_entry_create_view),
    path("scores/entries/<int:entry_id>", score_entry_detail_view),
    path("scores/entries/<int:entry_id>/", score_entry_detail_view),
    path("scores/phases/<str:phase_key>/advancement", advancement_rule_view),
    path("scores/phases/<str:phase_key>/advancement/", advancement_rule_view),
    path("scores/phases/<str:phase_key>/publish-advancement", publish_advancement_view),
    path("scores/phases/<str:phase_key>/publish-advancement/", publish_advancement_view),
]
