import json
import tempfile
from pathlib import Path

from django.test import TestCase, override_settings

from api.models import Account, AuditLog, Team
from api.services.auth_service import generate_session


class BackupRestoreApiTests(TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.media_dir = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(
            BACKUP_ROOT=self.tempdir.name,
            MEDIA_ROOT=self.media_dir.name,
            BACKUP_MAX_UPLOAD_MB=20,
        )
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.tempdir.cleanup)
        self.addCleanup(self.media_dir.cleanup)

        self.admin = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.team = Team.objects.create(
            code="T0001",
            name="Original Team",
            approval_status=Team.APPROVAL_APPROVED,
        )
        self.token = generate_session(self.admin)

        # Restoring rewrites accounts, phases and stations at once, so it is
        # master-only; creating and downloading backups stays with admins.
        self.master = Account.objects.create(
            username="master",
            email="master@example.com",
            password_hash="x",
            role=Account.ROLE_MASTER_ADMIN,
        )
        self.master_token = generate_session(self.master)

    def _auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def _master_auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.master_token}"}

    def test_create_list_and_download_backup(self):
        created = self.client.post("/api/admin/backups", **self._auth())
        self.assertEqual(created.status_code, 201)
        filename = created.json()["filename"]
        self.assertTrue((Path(self.tempdir.name) / filename).exists())

        listed = self.client.get("/api/admin/backups", **self._auth())
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["items"][0]["filename"], filename)

        downloaded = self.client.get(
            f"/api/admin/backups/{filename}",
            **self._auth(),
        )
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(downloaded["Content-Type"], "application/zip")
        downloaded.close()

    def test_restore_requires_explicit_confirmation(self):
        created = self.client.post("/api/admin/backups", **self._auth())
        response = self.client.post(
            "/api/admin/backups/restore",
            data=json.dumps({
                "backup_name": created.json()["filename"],
                "confirmation": "no",
            }),
            content_type="application/json",
            **self._master_auth(),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["error"],
            "restore_confirmation_required",
        )

    def test_restore_recovers_database_and_creates_safety_backup(self):
        created = self.client.post("/api/admin/backups", **self._auth())
        filename = created.json()["filename"]
        self.team.name = "Modified Team"
        self.team.save(update_fields=["name", "updated_at"])

        response = self.client.post(
            "/api/admin/backups/restore",
            data=json.dumps({
                "backup_name": filename,
                "confirmation": "RESTORE",
            }),
            content_type="application/json",
            **self._master_auth(),
        )

        self.assertEqual(response.status_code, 200)
        restored = Team.objects.get(code="T0001")
        self.assertEqual(restored.name, "Original Team")
        safety_name = response.json()["safety_backup"]["filename"]
        self.assertTrue((Path(self.tempdir.name) / safety_name).exists())
        self.assertTrue(AuditLog.objects.filter(action="backup.restore").exists())
        restored_admin = Account.objects.get(username="admin")
        self.assertIsNone(restored_admin.token)

    def test_plain_admin_cannot_restore(self):
        """Restore overwrites Account rows, so it would hand back every power."""
        created = self.client.post("/api/admin/backups", **self._auth())
        self.team.name = "Modified Team"
        self.team.save(update_fields=["name", "updated_at"])

        response = self.client.post(
            "/api/admin/backups/restore",
            data=json.dumps({
                "backup_name": created.json()["filename"],
                "confirmation": "RESTORE",
            }),
            content_type="application/json",
            **self._auth(),
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "master_admin_required")
        self.team.refresh_from_db()
        self.assertEqual(self.team.name, "Modified Team")
