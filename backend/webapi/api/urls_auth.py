"""Auth routes — §9.1"""

from django.urls import path
from api.views_auth import (
    login_view, me_view, logout_view,
    register_view, signup_view, google_login_view,
)

urlpatterns = [
    path("auth/login", login_view),
    path("auth/me", me_view),
    path("auth/logout", logout_view),
    path("auth/register", register_view),
    path("auth/signup", signup_view),
    path("auth/google", google_login_view),
]
