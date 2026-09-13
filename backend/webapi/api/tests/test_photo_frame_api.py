"""Tests for public photo-frame endpoints — gallery and detail."""

import tempfile
import io
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart

from api.models import Account, PhotoFrame
from api.services.auth_service import generate_session
from api.services import photo_frame_service


class PhotoFramePublicApiTests(TestCase):
    def setUp(self):
        self.active_frame = PhotoFrame.objects.create(
            title="Khung Avatar Tân Sinh Viên 2026",
            description="Mô tả khung tân sinh viên",
            width=1080,
            height=1080,
            is_active=True,
            sort_order=1,
            download_count=5,
        )
        self.inactive_frame = PhotoFrame.objects.create(
            title="Khung Nháp",
            description="Mô tả khung nháp",
            width=800,
            height=800,
            is_active=False,
            sort_order=2,
        )

    def test_list_public_frames_returns_only_active(self):
        resp = self.client.get("/api/public/frames")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("frames", data)
        frame_ids = [f["id"] for f in data["frames"]]
        self.assertIn(self.active_frame.id, frame_ids)
        self.assertNotIn(self.inactive_frame.id, frame_ids)

    def test_gallery_uses_image_endpoint_for_legacy_and_local_urls(self):
        for url in ("storage.example/frames/old.png", "/media/frames/local.png"):
            self.active_frame.image = {"url": url, "key": "frames/old.png", "storage": "r2"}
            self.active_frame.save()
            frame = self.client.get(f"/api/public/frames/{self.active_frame.id}").json()["frame"]
            self.assertEqual(frame["image_url"], f"http://testserver/api/public/frames/{self.active_frame.id}/image")

    def test_replace_image_with_multipart_patch(self):
        admin = Account.objects.create(username="frame-admin", role=Account.ROLE_ADMIN, password_hash="x")
        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            data = encode_multipart(BOUNDARY, {
                "file": SimpleUploadedFile("new.png", b"new-image", content_type="image/png"),
                "title": "Updated frame",
            })
            response = self.client.patch(
                f"/api/admin/frames/{self.active_frame.id}", data=data,
                content_type=MULTIPART_CONTENT,
                HTTP_AUTHORIZATION=f"Bearer {generate_session(admin)}",
            )
            self.assertEqual(response.status_code, 200, response.content)
            self.active_frame.refresh_from_db()
            self.assertEqual(self.active_frame.title, "Updated frame")
            self.assertEqual((Path(media_root) / self.active_frame.image["key"]).read_bytes(), b"new-image")

    def test_r2_frame_upload_preserves_image_dimensions(self):
        buffer = io.BytesIO()
        Image.new("RGBA", (32, 24)).save(buffer, format="PNG")
        uploaded = SimpleUploadedFile("frame.png", buffer.getvalue(), content_type="image/png")
        with patch("api.services.submission_storage_service._r2_client") as factory:
            # Boto3's managed transfer closes the input stream after upload.
            factory.return_value.upload_fileobj.side_effect = lambda file, *args, **kwargs: file.close()
            frame = photo_frame_service.create_frame(uploaded, "Frame", "", True, None)
        self.assertEqual((frame.width, frame.height), (32, 24))

    def test_get_public_frame_detail_success(self):
        resp = self.client.get(f"/api/public/frames/{self.active_frame.id}")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("frame", data)
        frame_data = data["frame"]
        self.assertEqual(frame_data["id"], self.active_frame.id)
        self.assertEqual(frame_data["title"], "Khung Avatar Tân Sinh Viên 2026")
        self.assertEqual(frame_data["download_count"], 5)
        self.assertEqual(frame_data["width"], 1080)
        self.assertEqual(frame_data["height"], 1080)

    def test_get_public_frame_detail_trailing_slash(self):
        resp = self.client.get(f"/api/public/frames/{self.active_frame.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["frame"]["id"], self.active_frame.id)

    def test_get_public_frame_detail_inactive_returns_404(self):
        resp = self.client.get(f"/api/public/frames/{self.inactive_frame.id}")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json(), {"error": "not_found"})

    def test_get_public_frame_detail_non_existent_returns_404(self):
        resp = self.client.get("/api/public/frames/999999")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json(), {"error": "not_found"})

    def test_get_public_frame_detail_method_not_allowed(self):
        resp = self.client.post(f"/api/public/frames/{self.active_frame.id}", {})
        self.assertEqual(resp.status_code, 405)


class PhotoFrameStorageCleanupTests(TestCase):
    """Frame image files must not leak on delete or on image replacement."""

    def _png(self, name: str) -> SimpleUploadedFile:
        return SimpleUploadedFile(name, b"\x89PNG\r\n\x1a\n-frame", content_type="image/png")

    def test_delete_frame_removes_stored_file(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                frame = photo_frame_service.create_frame(
                    self._png("a.png"), "Frame A", "desc", True, None,
                )
                path = Path(media_root) / frame.image["key"]
                self.assertTrue(path.exists())

                photo_frame_service.delete_frame(frame)
                self.assertFalse(path.exists())

    def test_replace_image_removes_old_file(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                frame = photo_frame_service.create_frame(
                    self._png("old.png"), "Frame B", "desc", True, None,
                )
                old_path = Path(media_root) / frame.image["key"]
                self.assertTrue(old_path.exists())

                frame = photo_frame_service.update_frame(frame, uploaded=self._png("new.png"))
                new_path = Path(media_root) / frame.image["key"]

                self.assertFalse(old_path.exists())
                self.assertTrue(new_path.exists())
                self.assertNotEqual(old_path, new_path)
