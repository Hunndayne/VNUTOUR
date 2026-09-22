from datetime import timedelta
from unittest.mock import patch

import pytest
from django.apps import apps
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from django.utils import timezone

if not apps.is_installed("photo_gallery"):
    pytest.skip("Use --ds=serverapi.settings_test_photos", allow_module_level=True)

from api.models import Account, Participant, Team, TeamMembership
from api.services.auth_service import generate_session
from photo_gallery.models import Album, SearchResult

pytestmark = pytest.mark.django_db


def make_account(role="participant", approval=None, linked=True):
    account = Account.objects.create(username="viewer", email="viewer@example.test", role=role, mssv="PHOTO01", password_hash="unused")
    if approval:
        participant = Participant.objects.create(account=account if linked else None, mssv=account.mssv, full_name="Viewer")
        team = Team.objects.create(code="PHOTOS", name="Photo team", approval_status=approval)
        TeamMembership.objects.create(participant=participant, team=team)
    return account


def gallery_requests(browser):
    album = Album.objects.create(title="Published", status="published", folder_id="folder_123456")
    result = SearchResult.objects.create(expires_at=timezone.now() + timedelta(minutes=10))
    return [
        browser.get("/api/photo-albums"),
        browser.get(f"/api/photo-albums/{album.pk}/photos"),
        browser.post("/api/photo-search", {"image": SimpleUploadedFile("face.png", b"reference", content_type="image/png")}),
        browser.get(f"/api/photo-search/{result.token}"),
    ]


@pytest.mark.parametrize("role, approval, status", [
    (None, None, 401),
    ("participant", None, 403),
    ("participant", "draft", 403),
    ("participant", "pending_approval", 403),
    ("participant", "rejected", 403),
    ("participant", "approved", 200),
    ("admin", None, 200),
    ("master_admin", None, 200),
    ("collab", None, 200),
    ("unknown", "approved", 403),
])
def test_all_gallery_endpoints_enforce_current_access(role, approval, status):
    cache.clear()
    browser = Client()
    if role:
        browser.defaults["HTTP_AUTHORIZATION"] = "Bearer " + generate_session(make_account(role, approval))
    with patch("photo_gallery.views.embed_reference", return_value=[1.] + [0.] * 127) as embed:
        responses = gallery_requests(browser)
    assert [response.status_code for response in responses] == [status] * 4
    assert all("no-store" in response["Cache-Control"] for response in responses)
    if status != 200:
        embed.assert_not_called()


@pytest.mark.parametrize("revocation", ["team", "membership", "account", "session"])
def test_existing_search_token_does_not_bypass_revoked_access(revocation):
    account = make_account(approval="approved")
    browser = Client(HTTP_AUTHORIZATION="Bearer " + generate_session(account))
    result = SearchResult.objects.create(expires_at=timezone.now() + timedelta(minutes=10))
    path = f"/api/photo-search/{result.token}"
    assert browser.get(path).status_code == 200
    if revocation == "team":
        Team.objects.update(approval_status="rejected")
    elif revocation == "membership":
        TeamMembership.objects.all().delete()
    elif revocation == "account":
        Account.objects.filter(pk=account.pk).update(is_active=False)
    else:
        Account.objects.filter(pk=account.pk).update(token_created_at=timezone.now() - timedelta(days=10))
    assert browser.get(path).status_code == (403 if revocation in {"team", "membership"} else 401)


def test_legacy_unlinked_member_is_allowed_but_another_accounts_profile_is_not():
    account = make_account(approval="approved", linked=False)
    browser = Client(HTTP_AUTHORIZATION="Bearer " + generate_session(account))
    assert browser.get("/api/photo-albums").status_code == 200
    other = Account.objects.create(username="other", email="other@example.test", password_hash="unused")
    Participant.objects.update(account=other)
    assert browser.get("/api/photo-albums").status_code == 403


def test_cookie_authenticated_search_requires_csrf():
    account = make_account(role="collab")
    browser = Client(enforce_csrf_checks=True)
    browser.cookies["token"] = generate_session(account)
    with patch("photo_gallery.views.embed_reference") as embed:
        response = browser.post("/api/photo-search", {})
    assert response.status_code == 403
    assert response.json()["error"] == "csrf_required"
    embed.assert_not_called()


def test_collaborator_can_view_but_cannot_manage_albums():
    account = make_account(role="collab")
    browser = Client(HTTP_AUTHORIZATION="Bearer " + generate_session(account))
    album = Album.objects.create(title="Draft", folder_id="folder_123456")
    assert browser.get("/api/admin/photo-albums").status_code == 403
    assert browser.post(f"/api/admin/photo-albums/{album.pk}/import-drive", "{}", content_type="application/json").status_code == 403
    assert browser.get(f"/api/photo-albums/{album.pk}/photos").status_code == 404
