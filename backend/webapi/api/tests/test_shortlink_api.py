import json
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from api.models import Account, ShortLink
from api.services.auth_service import generate_session


def _auth(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class ShortLinkAdminApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin", email="admin@example.com",
            password_hash="x", role=Account.ROLE_ADMIN,
        )
        self.admin_token = generate_session(self.admin)

    def _create(self, payload, token=None):
        return self.client.post(
            "/api/admin/short-links",
            data=json.dumps(payload),
            content_type="application/json",
            **_auth(token or self.admin_token),
        )

    def test_create_auto_generates_code(self):
        resp = self._create({"target_url": "https://example.com/form?very=long&query=1"})
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertTrue(body["code"])
        self.assertEqual(body["target_url"], "https://example.com/form?very=long&query=1")
        self.assertTrue(body["is_active"])
        self.assertIn("/s/", body["short_url"])

    def test_create_custom_code_normalized_and_taken(self):
        resp = self._create({"target_url": "https://example.com", "code": "DangKy2026"})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["code"], "dangky2026")

        dup = self._create({"target_url": "https://example.com", "code": "dangky2026"})
        self.assertEqual(dup.status_code, 400)
        self.assertEqual(dup.json()["error"], "code_taken")

    def test_create_validates_url_and_code(self):
        for payload, err in [
            ({"target_url": "javascript:alert(1)"}, "invalid_url"),
            ({"target_url": ""}, "invalid_url"),
            ({"target_url": "https://example.com", "code": "x"}, "invalid_code"),
            ({"target_url": "https://example.com", "code": "has space"}, "invalid_code"),
        ]:
            resp = self._create(payload)
            self.assertEqual(resp.status_code, 400, payload)
            self.assertEqual(resp.json()["error"], err, payload)

    def test_bare_domain_gets_https_prefix(self):
        resp = self._create({"target_url": "discord.gg/vnutour"})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["target_url"], "https://discord.gg/vnutour")

    def test_non_admin_cannot_manage_links(self):
        collab = Account.objects.create(
            username="collab", email="collab@example.com",
            password_hash="x", role=Account.ROLE_COLLAB,
        )
        resp = self._create(
            {"target_url": "https://example.com"}, token=generate_session(collab),
        )
        self.assertEqual(resp.status_code, 403)

        anon = self.client.get("/api/admin/short-links")
        self.assertEqual(anon.status_code, 401)

    def test_patch_updates_fields_and_clears_expiry(self):
        link = ShortLink.objects.create(
            code="abc123", target_url="https://example.com",
            expires_at=timezone.now() + timedelta(days=1),
        )
        resp = self.client.patch(
            "/api/admin/short-links/%d" % link.id,
            data=json.dumps({"target_url": "https://example.com/v2", "expires_at": ""}),
            content_type="application/json",
            **_auth(self.admin_token),
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["target_url"], "https://example.com/v2")
        self.assertIsNone(body["expires_at"])

        link.refresh_from_db()
        self.assertIsNone(link.expires_at)

    def test_delete_removes_link(self):
        link = ShortLink.objects.create(code="gone12", target_url="https://example.com")
        resp = self.client.delete(
            "/api/admin/short-links/%d" % link.id, **_auth(self.admin_token),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(ShortLink.objects.filter(pk=link.pk).exists())


class ShortLinkRedirectTests(TestCase):
    def setUp(self):
        self.link = ShortLink.objects.create(
            code="poster", target_url="https://example.com/register",
        )

    def test_redirect_counts_click(self):
        resp = self.client.get("/s/poster")
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp["Location"], "https://example.com/register")

        self.link.refresh_from_db()
        self.assertEqual(self.link.click_count, 1)
        self.assertIsNotNone(self.link.last_clicked_at)

    def test_code_lookup_is_case_insensitive(self):
        resp = self.client.get("/s/POSTER")
        self.assertEqual(resp.status_code, 302)

    def test_unknown_code_shows_404_page(self):
        resp = self.client.get("/s/nope")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("Link không tồn tại", resp.content.decode("utf-8"))

    def test_inactive_link_is_gone(self):
        self.link.is_active = False
        self.link.save(update_fields=["is_active"])
        resp = self.client.get("/s/poster")
        self.assertEqual(resp.status_code, 410)
        self.link.refresh_from_db()
        self.assertEqual(self.link.click_count, 0)

    def test_expired_link_is_gone(self):
        self.link.expires_at = timezone.now() - timedelta(minutes=1)
        self.link.save(update_fields=["expires_at"])
        resp = self.client.get("/s/poster")
        self.assertEqual(resp.status_code, 410)
        self.assertIn("hết hạn", resp.content.decode("utf-8"))
