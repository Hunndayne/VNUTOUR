import json
import tempfile
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import TestCase, override_settings
from django.utils import timezone

from api.models import (
    Account,
    FeedComment,
    FeedImage,
    FeedPost,
    FeedReaction,
    Participant,
    Team,
    TeamMembership,
)
from api.services import feed_service
from api.services.auth_service import generate_session


def _auth(token: str):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class FeedServiceUnitTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin_user",
            email="admin@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.user1 = Account.objects.create(
            username="user1",
            email="user1@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
        )
        self.user2 = Account.objects.create(
            username="user2",
            email="user2@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
        )

    def test_create_and_publish_post(self):
        # Create draft
        post = feed_service.create_post(
            author=self.admin,
            title="Thong bao 1",
            body="Noi dung markdown",
            status=FeedPost.STATUS_DRAFT,
        )
        self.assertEqual(post.status, FeedPost.STATUS_DRAFT)
        self.assertIsNone(post.published_at)

        # Update to published sets published_at
        updated = feed_service.update_post(post.id, status=FeedPost.STATUS_PUBLISHED)
        self.assertEqual(updated.status, FeedPost.STATUS_PUBLISHED)
        self.assertIsNotNone(updated.published_at)

        # Create directly as published
        post2 = feed_service.create_post(
            author=self.admin,
            title="Thong bao 2",
            body="Noi dung 2",
            status=FeedPost.STATUS_PUBLISHED,
        )
        self.assertEqual(post2.status, FeedPost.STATUS_PUBLISHED)
        self.assertIsNotNone(post2.published_at)

    def test_update_and_delete_post(self):
        post = feed_service.create_post(
            author=self.admin,
            title="Old Title",
            body="Old Body",
            status=FeedPost.STATUS_DRAFT,
        )
        updated = feed_service.update_post(
            post.id,
            title="New Title",
            body="New Body",
            cover_image_url="https://example.com/cover.jpg",
            is_pinned=True,
        )
        self.assertEqual(updated.title, "New Title")
        self.assertEqual(updated.body, "New Body")
        self.assertEqual(updated.cover_image_url, "https://example.com/cover.jpg")
        self.assertTrue(updated.is_pinned)

        ok = feed_service.delete_post(post.id)
        self.assertTrue(ok)
        self.assertFalse(FeedPost.objects.filter(id=post.id).exists())

    def test_delete_post_cleans_up_image_files(self):
        """Deleting a post removes stored files for both FK-linked images and
        orphan images (post is NULL) whose URL the post's body references."""
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                # A body image uploaded before the post exists → post is NULL.
                orphan = feed_service.upload_feed_image(
                    SimpleUploadedFile("body.png", b"\x89PNG-body", content_type="image/png"),
                    author=self.admin,
                    post_id=None,
                )
                # A cover image linked to the post.
                post = feed_service.create_post(
                    author=self.admin,
                    title="With images",
                    body=f"Intro\n\n![pic]({orphan.image_url})\n\nOutro",
                    status=FeedPost.STATUS_PUBLISHED,
                )
                linked = feed_service.upload_feed_image(
                    SimpleUploadedFile("cover.png", b"\x89PNG-cover", content_type="image/png"),
                    author=self.admin,
                    post_id=post.id,
                )

                orphan_path = Path(media_root) / orphan.storage_key
                linked_path = Path(media_root) / linked.storage_key
                self.assertTrue(orphan_path.exists())
                self.assertTrue(linked_path.exists())

                feed_service.delete_post(post.id)

                # Files gone, orphan row swept, FK-linked row cascaded away.
                self.assertFalse(orphan_path.exists())
                self.assertFalse(linked_path.exists())
                self.assertFalse(FeedImage.objects.filter(id=orphan.id).exists())
                self.assertFalse(FeedImage.objects.filter(id=linked.id).exists())

    def test_toggle_pin(self):
        post = feed_service.create_post(
            author=self.admin,
            title="Pin Test",
            body="Body",
            status=FeedPost.STATUS_PUBLISHED,
        )
        self.assertFalse(post.is_pinned)

        pinned = feed_service.toggle_pin(post.id)
        self.assertTrue(pinned.is_pinned)

        unpinned = feed_service.toggle_pin(post.id)
        self.assertFalse(unpinned.is_pinned)

    def test_reaction_toggle_on_off_and_change(self):
        post = feed_service.create_post(
            author=self.admin,
            title="Reaction Test",
            body="React here",
            status=FeedPost.STATUS_PUBLISHED,
        )

        # React "heart" -> added
        res1 = feed_service.toggle_reaction(post.id, self.user1, "heart")
        self.assertEqual(res1["action"], "added")
        self.assertEqual(res1["my_reaction"], "heart")
        self.assertEqual(res1["reaction_counts"]["heart"], 1)

        # React "heart" again -> removed
        res2 = feed_service.toggle_reaction(post.id, self.user1, "heart")
        self.assertEqual(res2["action"], "removed")
        self.assertIsNone(res2["my_reaction"])
        self.assertEqual(res2["reaction_counts"]["heart"], 0)

        # React "fire" -> added
        res3 = feed_service.toggle_reaction(post.id, self.user1, "fire")
        self.assertEqual(res3["action"], "added")
        self.assertEqual(res3["reaction_counts"]["fire"], 1)

        # React "like" -> changed
        res4 = feed_service.toggle_reaction(post.id, self.user1, "like")
        self.assertEqual(res4["action"], "changed")
        self.assertEqual(res4["my_reaction"], "like")
        self.assertEqual(res4["reaction_counts"]["fire"], 0)
        self.assertEqual(res4["reaction_counts"]["like"], 1)

    def test_unique_constraint_reaction(self):
        post = feed_service.create_post(
            author=self.admin,
            title="Unique Constraint Test",
            body="Body",
            status=FeedPost.STATUS_PUBLISHED,
        )
        FeedReaction.objects.create(post=post, account=self.user1, reaction_type="heart")
        with self.assertRaises(IntegrityError):
            FeedReaction.objects.create(post=post, account=self.user1, reaction_type="like")

    def test_comment_create_and_soft_delete(self):
        post = feed_service.create_post(
            author=self.admin,
            title="Comment Test",
            body="Body",
            status=FeedPost.STATUS_PUBLISHED,
        )

        comment = feed_service.create_comment(post.id, self.user1, "Bình luận đầu tiên")
        self.assertEqual(comment.body, "Bình luận đầu tiên")
        self.assertFalse(comment.is_deleted)
        self.assertEqual(feed_service.get_comment_count(post.id), 1)

        # Non-author user2 cannot delete user1's comment
        with self.assertRaises(PermissionError):
            feed_service.delete_comment(comment.id, self.user2)

        # Author user1 can delete own comment -> soft delete
        deleted = feed_service.delete_comment(comment.id, self.user1)
        self.assertTrue(deleted.is_deleted)
        self.assertEqual(feed_service.get_comment_count(post.id), 0)

        comments, total = feed_service.list_comments(post.id)
        self.assertEqual(total, 0)
        self.assertEqual(len(comments), 0)

    def test_comment_validation(self):
        post = feed_service.create_post(
            author=self.admin,
            title="Validation Test",
            body="Body",
            status=FeedPost.STATUS_PUBLISHED,
        )
        with self.assertRaises(ValueError):
            feed_service.create_comment(post.id, self.user1, "")
        with self.assertRaises(ValueError):
            feed_service.create_comment(post.id, self.user1, "a" * 1001)

    def test_bulk_summaries(self):
        p1 = feed_service.create_post(self.admin, "P1", "B1", status=FeedPost.STATUS_PUBLISHED)
        p2 = feed_service.create_post(self.admin, "P2", "B2", status=FeedPost.STATUS_PUBLISHED)

        feed_service.toggle_reaction(p1.id, self.user1, "heart")
        feed_service.toggle_reaction(p1.id, self.user2, "heart")
        feed_service.toggle_reaction(p2.id, self.user1, "fire")

        feed_service.create_comment(p1.id, self.user1, "Comment P1")

        react_map = feed_service.bulk_reaction_summaries([p1.id, p2.id], account=self.user1)
        self.assertEqual(react_map[p1.id]["reaction_counts"]["heart"], 2)
        self.assertEqual(react_map[p1.id]["my_reaction"], "heart")
        self.assertEqual(react_map[p2.id]["reaction_counts"]["fire"], 1)
        self.assertEqual(react_map[p2.id]["my_reaction"], "fire")

        comment_map = feed_service.bulk_comment_counts([p1.id, p2.id])
        self.assertEqual(comment_map[p1.id], 1)
        self.assertEqual(comment_map[p2.id], 0)


class FeedApiIntegrationTests(TestCase):
    def setUp(self):
        # Admin
        self.admin = Account.objects.create(
            username="admin_api",
            email="admin_api@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.admin_token = generate_session(self.admin)

        # Approved team participant
        self.approved_acc = Account.objects.create(
            username="approved_user",
            email="approved@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="APP001",
        )
        self.approved_part = Participant.objects.create(
            account=self.approved_acc,
            mssv="APP001",
            full_name="Approved Student",
            email="approved@example.com",
        )
        self.approved_team = Team.objects.create(
            code="TEAM_APP",
            name="Đội Đã Duyệt",
            approval_status=Team.APPROVAL_APPROVED,
        )
        TeamMembership.objects.create(
            team=self.approved_team,
            participant=self.approved_part,
            is_captain=True,
        )
        self.approved_token = generate_session(self.approved_acc)

        # Pending team participant
        self.pending_acc = Account.objects.create(
            username="pending_user",
            email="pending@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
            mssv="PEN001",
        )
        self.pending_part = Participant.objects.create(
            account=self.pending_acc,
            mssv="PEN001",
            full_name="Pending Student",
            email="pending@example.com",
        )
        self.pending_team = Team.objects.create(
            code="TEAM_PEN",
            name="Đội Chờ Duyệt",
            approval_status=Team.APPROVAL_PENDING,
        )
        TeamMembership.objects.create(
            team=self.pending_team,
            participant=self.pending_part,
            is_captain=True,
        )
        self.pending_token = generate_session(self.pending_acc)

        # No team participant
        self.noteam_acc = Account.objects.create(
            username="noteam_user",
            email="noteam@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
        )
        self.noteam_token = generate_session(self.noteam_acc)

    def test_admin_post_crud(self):
        # Create
        create_resp = self.client.post(
            "/api/admin/feed",
            data=json.dumps({
                "title": "Bai viet moi",
                "body": "Noi dung bai viet",
                "status": "draft",
            }),
            content_type="application/json",
            **_auth(self.admin_token),
        )
        self.assertEqual(create_resp.status_code, 201)
        post_id = create_resp.json()["post"]["id"]

        # List
        list_resp = self.client.get("/api/admin/feed", **_auth(self.admin_token))
        self.assertEqual(list_resp.status_code, 200)
        self.assertEqual(list_resp.json()["total"], 1)

        # Detail
        detail_resp = self.client.get(f"/api/admin/feed/{post_id}", **_auth(self.admin_token))
        self.assertEqual(detail_resp.status_code, 200)
        self.assertEqual(detail_resp.json()["post"]["title"], "Bai viet moi")

        # Update
        update_resp = self.client.put(
            f"/api/admin/feed/{post_id}",
            data=json.dumps({"title": "Tieu de cap nhat", "status": "published"}),
            content_type="application/json",
            **_auth(self.admin_token),
        )
        self.assertEqual(update_resp.status_code, 200)
        self.assertEqual(update_resp.json()["post"]["title"], "Tieu de cap nhat")
        self.assertEqual(update_resp.json()["post"]["status"], "published")

        # Pin
        pin_resp = self.client.post(f"/api/admin/feed/{post_id}/pin", **_auth(self.admin_token))
        self.assertEqual(pin_resp.status_code, 200)
        self.assertTrue(pin_resp.json()["is_pinned"])

        # Delete
        del_resp = self.client.delete(f"/api/admin/feed/{post_id}", **_auth(self.admin_token))
        self.assertEqual(del_resp.status_code, 200)
        self.assertTrue(del_resp.json()["ok"])

    def test_team_approval_gate_and_draft_visibility(self):
        # Create 1 draft and 1 published post
        draft = feed_service.create_post(
            self.admin, "Draft Post", "Draft Body", status=FeedPost.STATUS_DRAFT,
        )
        published = feed_service.create_post(
            self.admin, "Published Post", "Published Body", status=FeedPost.STATUS_PUBLISHED,
        )

        # Approved team: sees only published
        resp = self.client.get("/api/feed", **_auth(self.approved_token))
        self.assertEqual(resp.status_code, 200)
        posts = resp.json()["posts"]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["id"], published.id)

        # Pending team: 403
        pending_resp = self.client.get("/api/feed", **_auth(self.pending_token))
        self.assertEqual(pending_resp.status_code, 403)
        self.assertEqual(pending_resp.json()["error"], "team_not_approved")

        # No team: 403
        noteam_resp = self.client.get("/api/feed", **_auth(self.noteam_token))
        self.assertEqual(noteam_resp.status_code, 403)
        self.assertEqual(noteam_resp.json()["error"], "team_not_approved")

        # Unauthenticated: 401
        anon_resp = self.client.get("/api/feed")
        self.assertEqual(anon_resp.status_code, 401)

    def test_pagination(self):
        for i in range(5):
            feed_service.create_post(
                self.admin, f"Post {i}", f"Body {i}", status=FeedPost.STATUS_PUBLISHED,
            )

        resp1 = self.client.get("/api/feed?limit=2&offset=0", **_auth(self.approved_token))
        self.assertEqual(resp1.status_code, 200)
        data1 = resp1.json()
        self.assertEqual(len(data1["posts"]), 2)
        self.assertEqual(data1["total"], 5)

        resp2 = self.client.get("/api/feed?limit=2&offset=2", **_auth(self.approved_token))
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertEqual(len(data2["posts"]), 2)

    def test_latest_post_and_pin_ordering(self):
        p1 = feed_service.create_post(
            self.admin, "Post 1", "Body 1", status=FeedPost.STATUS_PUBLISHED,
        )
        p2 = feed_service.create_post(
            self.admin, "Post 2", "Body 2", status=FeedPost.STATUS_PUBLISHED,
        )

        # Pin Post 1 so it comes before Post 2
        feed_service.toggle_pin(p1.id)

        resp = self.client.get("/api/feed/latest", **_auth(self.approved_token))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["post"]["id"], p1.id)

        list_resp = self.client.get("/api/feed", **_auth(self.approved_token))
        posts = list_resp.json()["posts"]
        self.assertEqual(posts[0]["id"], p1.id)
        self.assertEqual(posts[1]["id"], p2.id)

    def test_reaction_and_comments_flow(self):
        post = feed_service.create_post(
            self.admin, "Discuss this", "Body", status=FeedPost.STATUS_PUBLISHED,
        )

        # Toggle reaction
        react_resp = self.client.post(
            f"/api/feed/{post.id}/react",
            data=json.dumps({"type": "fire"}),
            content_type="application/json",
            **_auth(self.approved_token),
        )
        self.assertEqual(react_resp.status_code, 200)
        self.assertEqual(react_resp.json()["action"], "added")
        self.assertEqual(react_resp.json()["my_reaction"], "fire")
        self.assertEqual(react_resp.json()["reaction_counts"]["fire"], 1)

        # Create comment
        cmt_resp = self.client.post(
            f"/api/feed/{post.id}/comments",
            data=json.dumps({"body": "Chuc mung su kien!"}),
            content_type="application/json",
            **_auth(self.approved_token),
        )
        self.assertEqual(cmt_resp.status_code, 201)
        comment_data = cmt_resp.json()["comment"]
        self.assertEqual(comment_data["body"], "Chuc mung su kien!")
        self.assertEqual(comment_data["team_name"], "Đội Đã Duyệt")
        self.assertTrue(comment_data["is_my_comment"])
        comment_id = comment_data["id"]

        # List comments
        list_cmt_resp = self.client.get(
            f"/api/feed/{post.id}/comments",
            **_auth(self.approved_token),
        )
        self.assertEqual(list_cmt_resp.status_code, 200)
        self.assertEqual(len(list_cmt_resp.json()["comments"]), 1)

        # Participant deletes own comment
        del_cmt_resp = self.client.delete(
            f"/api/feed/{post.id}/comments/{comment_id}",
            **_auth(self.approved_token),
        )
        self.assertEqual(del_cmt_resp.status_code, 200)
        self.assertTrue(del_cmt_resp.json()["ok"])

        # Admin delete another comment
        c2 = feed_service.create_comment(post.id, self.approved_acc, "Another comment")
        admin_del_resp = self.client.delete(
            f"/api/admin/feed/{post.id}/comments/{c2.id}",
            **_auth(self.admin_token),
        )
        self.assertEqual(admin_del_resp.status_code, 200)
        self.assertTrue(admin_del_resp.json()["ok"])
