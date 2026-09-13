import json
from datetime import timedelta
from unittest.mock import patch

from botocore.exceptions import ClientError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from api.models import Account, FeedPost, FeedVideo
from api.services import feed_service, feed_video_service as videos
from api.services.auth_service import generate_session


MP4 = b"\x00\x00\x00\x18ftypisom" + b"video-test-data"


class FakeR2:
    def __init__(self):
        self.uploads = {}
        self.objects = {}
        self.deleted = []
        self.aborted = []
        self.fail_delete = False

    def create_multipart_upload(self, **args):
        self.uploads[args["Key"]] = {"id": args["Key"], "parts": {}, "type": args["ContentType"]}
        return {"UploadId": args["Key"]}

    def upload_part(self, **args):
        self.uploads[args["Key"]]["parts"][args["PartNumber"]] = args["Body"]
        return {"ETag": str(args["PartNumber"])}

    def complete_multipart_upload(self, **args):
        if args["Key"] not in self.uploads:
            raise ClientError({"Error": {"Code": "NoSuchUpload"}}, "CompleteMultipartUpload")
        upload = self.uploads.pop(args["Key"])
        parts = args["MultipartUpload"]["Parts"]
        data = b"".join(upload["parts"][p["PartNumber"]] for p in parts)
        self.objects[args["Key"]] = {"ContentLength": len(data), "ContentType": upload["type"]}

    def head_object(self, **args):
        if args["Key"] not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return self.objects[args["Key"]]

    def delete_object(self, **args):
        if self.fail_delete:
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "DeleteObject")
        self.objects.pop(args["Key"], None)
        self.deleted.append(args["Key"])

    def get_paginator(self, name):
        assert name == "list_multipart_uploads"
        return self

    def paginate(self, **args):
        yield {"Uploads": [{"Key": key, "UploadId": item["id"]} for key, item in self.uploads.items() if key.startswith(args["Prefix"])]}

    def abort_multipart_upload(self, **args):
        self.uploads.pop(args["Key"], None)
        self.aborted.append(args["Key"])


@override_settings(R2_BUCKET="vnutour", R2_PUBLIC_BASE_URL="storage.example")
class FeedVideoTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(username="video-admin", email="video@example.com", role=Account.ROLE_ADMIN, password_hash="x")
        self.other = Account.objects.create(username="other-admin", email="other@example.com", role=Account.ROLE_ADMIN, password_hash="x")
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {generate_session(self.admin)}"}
        self.r2 = FakeR2()
        self.client_patch = patch.object(videos, "_r2_client", return_value=self.r2)
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)

    def ready(self, author=None):
        author = author or self.admin
        video = videos.begin_upload(author, "clip.mp4", len(MP4))
        videos.upload_part(video.id, author, 1, SimpleUploadedFile("part", MP4))
        return videos.complete_upload(video.id, author)

    def test_boundary_100_mb_accepted_and_one_byte_over_rejected_before_r2(self):
        video = videos.begin_upload(self.admin, "max.mp4", videos.MAX_VIDEO_BYTES)
        self.assertEqual(video.size, 100 * 1024 * 1024)
        with self.assertRaisesMessage(ValueError, "video_too_large"):
            videos.begin_upload(self.admin, "large.mp4", videos.MAX_VIDEO_BYTES + 1)
        self.assertEqual(len(self.r2.uploads), 1)

    def test_invalid_size_and_format_rejected(self):
        for size in (0, -1, True, "100", None):
            with self.assertRaises(ValueError):
                videos.begin_upload(self.admin, "clip.mp4", size)
        with self.assertRaisesMessage(ValueError, "video_type_not_allowed"):
            videos.begin_upload(self.admin, "script.html", 100)
        self.assertFalse(FeedVideo.objects.exists())

    def test_multipart_upload_enforces_each_part_and_total_size(self):
        video = videos.begin_upload(self.admin, "clip.mp4", videos.PART_BYTES + 1)
        with self.assertRaisesMessage(ValueError, "invalid_video_part_size"):
            videos.upload_part(video.id, self.admin, 1, SimpleUploadedFile("part", MP4))
        first = MP4 + b"x" * (videos.PART_BYTES - len(MP4))
        videos.upload_part(video.id, self.admin, 1, SimpleUploadedFile("part", first))
        with self.assertRaisesMessage(ValueError, "video_upload_incomplete"):
            videos.complete_upload(video.id, self.admin)
        with self.assertRaisesMessage(ValueError, "invalid_video_part_size"):
            videos.upload_part(video.id, self.admin, 2, SimpleUploadedFile("part", b"xx"))
        videos.upload_part(video.id, self.admin, 2, SimpleUploadedFile("part", b"x"))
        done = videos.complete_upload(video.id, self.admin)
        self.assertEqual(done.state, "ready")
        self.assertEqual(self.r2.objects[done.storage_key]["ContentLength"], videos.PART_BYTES + 1)

    def test_disguised_non_video_rejected(self):
        video = videos.begin_upload(self.admin, "clip.mp4", 16)
        with self.assertRaisesMessage(ValueError, "invalid_video_file"):
            videos.upload_part(video.id, self.admin, 1, SimpleUploadedFile("part", b"x" * 16))

    def test_webm_is_supported(self):
        video = videos.begin_upload(self.admin, "clip.webm", 8)
        videos.upload_part(video.id, self.admin, 1, SimpleUploadedFile("part", b"\x1a\x45\xdf\xa3test"))
        self.assertEqual(videos.complete_upload(video.id, self.admin).content_type, "video/webm")

    def test_delete_post_removes_object_before_removing_record(self):
        video = self.ready()
        post = feed_service.create_post(self.admin, "Video", "Body", video_ids=[video.id])
        feed_service.delete_post(post.id)
        self.assertNotIn(video.storage_key, self.r2.objects)
        self.assertFalse(FeedVideo.objects.filter(pk=video.id).exists())
        self.assertFalse(FeedPost.objects.filter(pk=post.id).exists())

    def test_r2_deletion_failure_keeps_post_and_video_for_retry(self):
        video = self.ready()
        post = feed_service.create_post(self.admin, "Video", "Body", video_ids=[video.id])
        self.r2.fail_delete = True
        response = self.client.delete(f"/api/admin/feed/{post.id}", **self.auth)
        self.assertEqual(response.status_code, 503)
        self.assertTrue(FeedVideo.objects.filter(pk=video.id, post=post).exists())
        self.assertTrue(FeedPost.objects.filter(pk=post.id).exists())
        self.r2.fail_delete = False
        self.assertEqual(self.client.delete(f"/api/admin/feed/{post.id}", **self.auth).status_code, 200)
        self.assertNotIn(video.storage_key, self.r2.objects)

    def test_removing_video_on_save_deletes_only_removed_object(self):
        first, second = self.ready(), self.ready()
        post = feed_service.create_post(self.admin, "Video", "Body", video_ids=[first.id, second.id])
        feed_service.update_post(post.id, video_ids=[second.id], _video_author=self.admin)
        self.assertNotIn(first.storage_key, self.r2.objects)
        self.assertIn(second.storage_key, self.r2.objects)
        self.assertEqual(list(post.videos.values_list("id", flat=True)), [second.id])

    def test_cancel_aborts_incomplete_multipart_and_deletes_tracking(self):
        video = videos.begin_upload(self.admin, "clip.mp4", len(MP4))
        videos.upload_part(video.id, self.admin, 1, SimpleUploadedFile("part", MP4))
        videos.discard_upload(video.id, self.admin)
        self.assertFalse(self.r2.uploads)
        self.assertIn(video.storage_key, self.r2.aborted)
        self.assertFalse(FeedVideo.objects.exists())

    def test_sweeper_cleans_abandoned_not_attached_videos(self):
        abandoned = self.ready()
        pending = videos.begin_upload(self.admin, "pending.mp4", 100)
        attached = self.ready()
        feed_service.create_post(self.admin, "Published", "Body", video_ids=[attached.id])
        FeedVideo.objects.update(updated_at=timezone.now() - timedelta(hours=25))
        self.assertEqual(videos.cleanup_abandoned_uploads(), (2, 0))
        self.assertNotIn(abandoned.storage_key, self.r2.objects)
        self.assertNotIn(pending.storage_key, self.r2.uploads)
        self.assertIn(attached.storage_key, self.r2.objects)

    def test_sweeper_preserves_record_if_r2_fails(self):
        video = self.ready()
        FeedVideo.objects.filter(pk=video.id).update(updated_at=timezone.now() - timedelta(hours=25))
        self.r2.fail_delete = True
        self.assertEqual(videos.cleanup_abandoned_uploads(), (0, 1))
        self.assertTrue(FeedVideo.objects.filter(pk=video.id).exists())

    def test_cannot_attach_others_upload_or_share_between_posts(self):
        video = self.ready()
        with self.assertRaisesMessage(ValueError, "video_not_available"):
            feed_service.create_post(self.other, "Other", "Body", video_ids=[video.id])
        post = feed_service.create_post(self.admin, "Own", "Body", video_ids=[video.id])
        with self.assertRaisesMessage(ValueError, "video_not_available"):
            feed_service.create_post(self.admin, "Another", "Body", video_ids=[video.id])
        with self.assertRaisesMessage(ValueError, "video_in_use"):
            videos.discard_upload(video.id, self.admin)
        self.assertEqual(FeedVideo.objects.get(pk=video.id).post_id, post.id)

    def test_api_upload_create_display_and_remove(self):
        started = self.client.post('/api/admin/feed/videos', json.dumps({"name": "clip.mp4", "size": len(MP4)}), content_type="application/json", **self.auth)
        self.assertEqual(started.status_code, 201)
        video_id = started.json()["video"]["id"]
        part = self.client.post(f'/api/admin/feed/videos/{video_id}/parts/1', {"part": SimpleUploadedFile("part", MP4)}, **self.auth)
        self.assertEqual(part.status_code, 200)
        done = self.client.post(f'/api/admin/feed/videos/{video_id}', **self.auth)
        self.assertEqual(done.status_code, 200)
        self.assertTrue(done.json()["video"]["url"].startswith("https://storage.example/feed-videos/"))
        created = self.client.post('/api/admin/feed', json.dumps({"title": "Video", "video_ids": [video_id], "status": "published"}), content_type="application/json", **self.auth)
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["post"]["videos"][0]["id"], video_id)
        post_id = created.json()["post"]["id"]
        removed = self.client.put(f'/api/admin/feed/{post_id}', json.dumps({"video_ids": []}), content_type="application/json", **self.auth)
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.json()["post"]["videos"], [])
        self.assertFalse(self.r2.objects)

    def test_upload_routes_require_admin_and_upload_owner(self):
        self.assertEqual(self.client.post('/api/admin/feed/videos').status_code, 401)
        user = Account.objects.create(username="participant-video", email="participant@example.com", role=Account.ROLE_PARTICIPANT, password_hash="x")
        response = self.client.post('/api/admin/feed/videos', HTTP_AUTHORIZATION=f"Bearer {generate_session(user)}")
        self.assertEqual(response.status_code, 403)
        video = self.ready(self.other)
        self.assertEqual(self.client.delete(f'/api/admin/feed/videos/{video.id}', **self.auth).status_code, 404)
