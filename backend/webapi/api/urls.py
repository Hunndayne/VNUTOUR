"""
Main API URL router — delegates to domain-specific sub-routers.
"""

from django.urls import path, include

from .urls_auth import urlpatterns as auth_patterns
from .urls_public import urlpatterns as public_patterns
from .urls_register import urlpatterns as register_patterns
from .urls_participant import urlpatterns as participant_patterns
from .urls_admin import urlpatterns as admin_patterns
from .urls_program import urlpatterns as program_patterns
from .urls_station import urlpatterns as station_patterns
from .urls_assignment import urlpatterns as assignment_patterns
from .urls_checkin import urlpatterns as checkin_patterns
from .urls_score import urlpatterns as score_patterns
from .urls_discord import urlpatterns as discord_patterns
from .urls_dashboard import urlpatterns as dashboard_patterns
from .urls_email import urlpatterns as email_patterns
from .urls_audit import urlpatterns as audit_patterns
from .urls_report import urlpatterns as report_patterns
from .urls_backup import urlpatterns as backup_patterns

urlpatterns = (
    auth_patterns
    + public_patterns
    + register_patterns
    + participant_patterns
    + admin_patterns
    + program_patterns
    + station_patterns
    + assignment_patterns
    + checkin_patterns
    + score_patterns
    + discord_patterns
    + dashboard_patterns
    + email_patterns
    + audit_patterns
    + report_patterns
    + backup_patterns
)
