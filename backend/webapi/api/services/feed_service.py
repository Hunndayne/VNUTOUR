"""Business logic service for Organizer Feed/Announcements, Reactions, and Comments."""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.db.models import Count
from django.utils import timezone

from api.models import (
    Account,
    FeedComment,
    FeedImage,
    FeedPost,
    FeedReaction,
    TeamMembership,
)
from api.services.submission_storage_service import (
    STORAGE_LOCAL,
    STORAGE_R2,
    _r2_client,
    _safe_name,
    _store_local,
    delete_stored_object,
)

logger = logging.getLogger(__name__)

FEED_IMAGE_ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}
FEED_IMAGE_MAX_BYTES = 15 * 1024 * 1024

# Matches a markdown image tag's URL: ![alt](url)
_MD_IMAGE_URL = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")

REACTION_KEYS = [k for k, _ in FeedReaction.REACTION_CHOICES]


# =====================================================================
# Post CRUD
# =====================================================================

def list_published_posts(limit: int = 10, offset: int = 0) -> tuple[list[FeedPost], int]:
    """List published posts ordered by pinned status and published date."""
    qs = FeedPost.objects.filter(status=FeedPost.STATUS_PUBLISHED).select_related("author")
    total = qs.count()
    return list(qs[offset : offset + limit]), total


def get_latest_published_post() -> FeedPost | None:
    """Get the single latest published post (pinned post prioritized)."""
    return FeedPost.objects.filter(status=FeedPost.STATUS_PUBLISHED).select_related("author").first()


def list_all_posts(limit: int = 20, offset: int = 0) -> tuple[list[FeedPost], int]:
    """List all posts including drafts for admin view."""
    qs = FeedPost.objects.all().select_related("author")
    total = qs.count()
    return list(qs[offset : offset + limit]), total


def create_post(
    author: Account | None,
    title: str,
    body: str,
    cover_image_url: str = "",
    status: str = FeedPost.STATUS_DRAFT,
    is_pinned: bool = False,
) -> FeedPost:
    """Create a new feed post."""
    title = (title or "").strip()
    if not title:
        raise ValueError("missing_title")
    if status not in (FeedPost.STATUS_DRAFT, FeedPost.STATUS_PUBLISHED):
        raise ValueError("invalid_status")

    published_at = timezone.now() if status == FeedPost.STATUS_PUBLISHED else None
    return FeedPost.objects.create(
        author=author,
        title=title,
        body=body or "",
        cover_image_url=(cover_image_url or "").strip(),
        status=status,
        is_pinned=bool(is_pinned),
        published_at=published_at,
    )


def update_post(post_id: int, **fields) -> FeedPost:
    """Update fields on a feed post."""
    post = FeedPost.objects.filter(id=post_id).first()
    if not post:
        raise ValueError("post_not_found")

    update_fields = ["updated_at"]
    if "title" in fields:
        title = (fields["title"] or "").strip()
        if not title:
            raise ValueError("missing_title")
        post.title = title
        update_fields.append("title")

    if "body" in fields:
        post.body = fields["body"] or ""
        update_fields.append("body")

    if "cover_image_url" in fields:
        post.cover_image_url = (fields["cover_image_url"] or "").strip()
        update_fields.append("cover_image_url")

    if "is_pinned" in fields:
        post.is_pinned = bool(fields["is_pinned"])
        update_fields.append("is_pinned")

    if "status" in fields:
        new_status = fields["status"]
        if new_status not in (FeedPost.STATUS_DRAFT, FeedPost.STATUS_PUBLISHED):
            raise ValueError("invalid_status")
        if new_status == FeedPost.STATUS_PUBLISHED and not post.published_at:
            post.published_at = timezone.now()
            update_fields.append("published_at")
        post.status = new_status
        update_fields.append("status")

    post.save(update_fields=update_fields)
    return post


def _urls_referenced_by_post(post: FeedPost) -> set[str]:
    """Every image URL a post points at: its cover plus any markdown body image."""
    urls: set[str] = set()
    if post.cover_image_url:
        urls.add(post.cover_image_url.strip())
    for match in _MD_IMAGE_URL.finditer(post.body or ""):
        urls.add(match.group(1).strip())
    return urls


def delete_post(post_id: int) -> bool:
    """Delete a post and its reactions, comments, and image files.

    Reactions/comments and FK-linked FeedImage rows go via cascade. The stored
    image *files* (R2/local) are cleaned up here — including orphan FeedImage
    rows (post is NULL) whose URL the post references, which happens whenever an
    image is uploaded while composing a brand-new post (no id yet to link to).
    """
    post = FeedPost.objects.filter(id=post_id).first()
    if not post:
        raise ValueError("post_not_found")

    images = list(FeedImage.objects.filter(post=post))

    referenced = _urls_referenced_by_post(post)
    orphans = []
    if referenced:
        orphans = list(
            FeedImage.objects.filter(post__isnull=True, image_url__in=referenced)
        )
        images.extend(orphans)

    for img in images:
        delete_stored_object(img.storage_type, img.storage_key)

    # Cascade only removes rows tied to the post; orphan rows need an explicit
    # delete now that their files are gone.
    if orphans:
        FeedImage.objects.filter(id__in=[o.id for o in orphans]).delete()

    post.delete()
    return True


def toggle_pin(post_id: int) -> FeedPost:
    """Toggle the pinned state of a feed post."""
    post = FeedPost.objects.filter(id=post_id).first()
    if not post:
        raise ValueError("post_not_found")
    post.is_pinned = not post.is_pinned
    post.save(update_fields=["is_pinned", "updated_at"])
    return post


# =====================================================================
# Images
# =====================================================================

def upload_feed_image(file, author: Account | None = None, post_id: int | None = None) -> FeedImage:
    """Upload an image to R2 or local storage and return a FeedImage object."""
    extension = Path(file.name).suffix.lower().lstrip(".")
    if extension not in FEED_IMAGE_ALLOWED_EXTENSIONS:
        raise ValueError("file_type_not_allowed")
    if file.size > FEED_IMAGE_MAX_BYTES:
        raise ValueError("file_too_large")

    client = _r2_client()
    safe_name = _safe_name(file.name)
    key = f"feed/{uuid.uuid4().hex}_{safe_name}"
    storage_type = STORAGE_LOCAL
    image_url = ""

    if client is not None:
        try:
            file.seek(0)
            content_type = getattr(file, "content_type", "") or "image/jpeg"
            client.upload_fileobj(
                file,
                settings.R2_BUCKET,
                key,
                ExtraArgs={"ContentType": content_type},
            )
            storage_type = STORAGE_R2
            if settings.R2_PUBLIC_BASE_URL:
                image_url = f"{settings.R2_PUBLIC_BASE_URL}/{key}"
            else:
                image_url = f"{settings.MEDIA_URL.rstrip('/')}/{key}"
        except Exception:
            logger.exception("R2 upload failed for %s; falling back to local storage", key)
            file.seek(0)

    if not image_url:
        storage_type = STORAGE_LOCAL
        image_url = _store_local(key, file)

    post = FeedPost.objects.filter(id=post_id).first() if post_id else None

    return FeedImage.objects.create(
        post=post,
        image_url=image_url,
        storage_type=storage_type,
        storage_key=key,
        original_filename=file.name,
        uploaded_by=author,
    )


# =====================================================================
# Reactions
# =====================================================================

def get_reaction_summary(post_id: int, account: Account | None = None) -> dict:
    """Get reaction counts and current user's reaction for a post."""
    counts = {k: 0 for k in REACTION_KEYS}
    qs = (
        FeedReaction.objects.filter(post_id=post_id)
        .values("reaction_type")
        .annotate(count=Count("id"))
    )
    for row in qs:
        rtype = row["reaction_type"]
        if rtype in counts:
            counts[rtype] = row["count"]

    my_reaction = None
    if account:
        user_react = FeedReaction.objects.filter(post_id=post_id, account=account).first()
        if user_react:
            my_reaction = user_react.reaction_type

    return {
        "reaction_counts": counts,
        "my_reaction": my_reaction,
    }


def bulk_reaction_summaries(post_ids: list[int], account: Account | None = None) -> dict[int, dict]:
    """Batch-fetch reaction counts and user's reaction for multiple posts."""
    result = {
        pid: {
            "reaction_counts": {k: 0 for k in REACTION_KEYS},
            "my_reaction": None,
        }
        for pid in post_ids
    }
    if not post_ids:
        return result

    qs = (
        FeedReaction.objects.filter(post_id__in=post_ids)
        .values("post_id", "reaction_type")
        .annotate(count=Count("id"))
    )
    for row in qs:
        pid = row["post_id"]
        rtype = row["reaction_type"]
        if pid in result and rtype in result[pid]["reaction_counts"]:
            result[pid]["reaction_counts"][rtype] = row["count"]

    if account:
        user_reacts = FeedReaction.objects.filter(post_id__in=post_ids, account=account)
        for r in user_reacts:
            if r.post_id in result:
                result[r.post_id]["my_reaction"] = r.reaction_type

    return result


def toggle_reaction(post_id: int, account: Account, reaction_type: str) -> dict:
    """Toggle on, toggle off, or change reaction for a user on a post."""
    if reaction_type not in REACTION_KEYS:
        raise ValueError("invalid_reaction_type")

    post = FeedPost.objects.filter(id=post_id).first()
    if not post:
        raise ValueError("post_not_found")

    existing = FeedReaction.objects.filter(post=post, account=account).first()
    if existing:
        if existing.reaction_type == reaction_type:
            existing.delete()
            action = "removed"
        else:
            existing.reaction_type = reaction_type
            existing.save(update_fields=["reaction_type"])
            action = "changed"
    else:
        FeedReaction.objects.create(post=post, account=account, reaction_type=reaction_type)
        action = "added"

    summary = get_reaction_summary(post_id, account)
    return {
        "action": action,
        "reaction_counts": summary["reaction_counts"],
        "my_reaction": summary["my_reaction"],
    }


# =====================================================================
# Comments
# =====================================================================

def list_comments(post_id: int, limit: int = 50, offset: int = 0) -> tuple[list[FeedComment], int]:
    """List non-deleted comments for a post, newest first."""
    qs = FeedComment.objects.filter(post_id=post_id, is_deleted=False).select_related("author")
    total = qs.count()
    return list(qs[offset : offset + limit]), total


def create_comment(post_id: int, author: Account, body: str) -> FeedComment:
    """Create a new comment on a post."""
    post = FeedPost.objects.filter(id=post_id).first()
    if not post:
        raise ValueError("post_not_found")

    body = (body or "").strip()
    if not body:
        raise ValueError("empty_body")
    if len(body) > 1000:
        raise ValueError("comment_too_long")

    return FeedComment.objects.create(
        post=post,
        author=author,
        body=body,
    )


def delete_comment(comment_id: int, by_account: Account) -> FeedComment:
    """Soft delete a comment if caller is author or admin."""
    comment = FeedComment.objects.filter(id=comment_id).first()
    if not comment:
        raise ValueError("comment_not_found")

    is_admin = by_account.role in (Account.ROLE_ADMIN, Account.ROLE_MASTER_ADMIN)
    if not is_admin and comment.author_id != by_account.id:
        raise PermissionError("forbidden")

    comment.is_deleted = True
    comment.save(update_fields=["is_deleted", "updated_at"])
    return comment


def get_comment_count(post_id: int) -> int:
    """Return count of active comments on a post."""
    return FeedComment.objects.filter(post_id=post_id, is_deleted=False).count()


def bulk_comment_counts(post_ids: list[int]) -> dict[int, int]:
    """Batch-fetch comment counts for multiple posts."""
    result = {pid: 0 for pid in post_ids}
    if not post_ids:
        return result

    qs = (
        FeedComment.objects.filter(post_id__in=post_ids, is_deleted=False)
        .values("post_id")
        .annotate(count=Count("id"))
    )
    for row in qs:
        result[row["post_id"]] = row["count"]
    return result
