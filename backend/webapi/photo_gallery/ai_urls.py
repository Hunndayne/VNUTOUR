from django.urls import path
from . import ai_views

urlpatterns = [path("health/live", ai_views.live), path("health/ready", ai_views.ready), path("v1/embed", ai_views.embed)]
