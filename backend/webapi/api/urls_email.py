from django.urls import path

from . import views_email

urlpatterns = [
    path("admin/send-email", views_email.send_email_view),
    path("admin/email-template", views_email.email_template_view),
]
