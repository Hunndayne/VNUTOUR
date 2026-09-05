"""API views for BTC Feed/Announcements, Reactions, and Comments."""

from __future__ import annotations

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, FeedComment, FeedPost, Team, TeamMembership
from api.services import feed_service
from .views_shared import (
    _auth_or_401,
    _dt_to_iso,
    _json_body,
    _require_role,
    is_admin,
)


def _require_approved_team(request: HttpRequest) -> tuple[Account | None, Team | None, JsonResponse | None]:
    """Verify that the user is authenticated and belongs to an approved team, or is an admin.
    Returns (account, team, error_response).
    """
    acc, err = _auth_or_401(request)
    if err:
        return None, None, err

    if is_admin(acc):
        team = None
        if acc.mssv:
            m = TeamMembership.objects.filter(participant__mssv=acc.mssv).select_related("team").first()
            if m:
                team = m.team
        return acc, team, None

    if not acc.mssv:
        return None, None, JsonResponse({"error": "team_not_approved"}, status=403)

    membership = (
        TeamMembership.objects.filter(participant__mssv=acc.mssv)
        .select_related("team")
        .first()
    )
    if not membership or membership.team.approval_status != Team.APPROVAL_APPROVED:
        return None, None, JsonResponse({"error": "team_not_approved"}, status=403)

    return acc, membership.team, None


def _format_post(post: FeedPost, reactions: dict, comment_count: int) -> dict:
    author_name = "BTC VNUTour"
    if post.author:
        author_name = post.author.full_name or post.author.username or "BTC VNUTour"
    return {
        "id": post.id,
        "title": post.title,
        "body": post.body,
        "cover_image_url": post.cover_image_url,
        "status": post.status,
        "is_pinned": post.is_pinned,
        "author_name": author_name,
        "published_at": _dt_to_iso(post.published_at),
        "created_at": _dt_to_iso(post.created_at),
        "updated_at": _dt_to_iso(post.updated_at),
        "reaction_counts": reactions.get("reaction_counts", {}),
        "my_reaction": reactions.get("my_reaction"),
        "comment_count": comment_count,
    }


def _build_team_map(comments: list[FeedComment]) -> dict[str, str]:
    mssvs = [c.author.mssv for c in comments if c.author and c.author.mssv]
    if not mssvs:
        return {}
    memberships = TeamMembership.objects.filter(participant__mssv__in=mssvs).select_related("team")
    return {m.participant.mssv: m.team.name for m in memberships if m.team}


def _format_comment(comment: FeedComment, team_map: dict[str, str], current_acc: Account | None) -> dict:
    author_name = ""
    team_name = ""
    if comment.author:
        author_name = comment.author.full_name or comment.author.username
        if comment.author.mssv and comment.author.mssv in team_map:
            team_name = team_map[comment.author.mssv]
        elif comment.author.role in (Account.ROLE_ADMIN, Account.ROLE_MASTER_ADMIN):
            team_name = "BTC"

    return {
        "id": comment.id,
        "post_id": comment.post_id,
        "author_id": comment.author_id,
        "author_name": author_name,
        "team_name": team_name,
        "body": comment.body,
        "is_my_comment": bool(current_acc and comment.author_id == current_acc.id),
        "created_at": _dt_to_iso(comment.created_at),
    }


# =====================================================================
# Participant Endpoints
# =====================================================================

@csrf_exempt
def participant_feed_list_view(request: HttpRequest):
    """GET /api/feed: list published posts with pagination, reactions, and comment counts."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, _team, err = _require_approved_team(request)
    if err:
        return err

    try:
        limit = min(50, max(1, int(request.GET.get("limit", 10))))
        offset = max(0, int(request.GET.get("offset", 0)))
    except (ValueError, TypeError):
        limit = 10
        offset = 0

    posts, total = feed_service.list_published_posts(limit=limit, offset=offset)
    post_ids = [p.id for p in posts]

    reactions_map = feed_service.bulk_reaction_summaries(post_ids, account=acc)
    comments_map = feed_service.bulk_comment_counts(post_ids)

    payload = [
        _format_post(p, reactions_map.get(p.id, {}), comments_map.get(p.id, 0))
        for p in posts
    ]

    return JsonResponse({
        "posts": payload,
        "total": total,
        "limit": limit,
        "offset": offset,
    })


@csrf_exempt
def participant_feed_latest_view(request: HttpRequest):
    """GET /api/feed/latest: get the single latest published post."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, _team, err = _require_approved_team(request)
    if err:
        return err

    post = feed_service.get_latest_published_post()
    if not post:
        return JsonResponse({"post": None})

    reactions = feed_service.get_reaction_summary(post.id, account=acc)
    comment_count = feed_service.get_comment_count(post.id)

    return JsonResponse({
        "post": _format_post(post, reactions, comment_count),
    })


@csrf_exempt
def participant_feed_react_view(request: HttpRequest, post_id: int):
    """POST /api/feed/<id>/react: toggle or switch emoji reaction."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, _team, err = _require_approved_team(request)
    if err:
        return err

    data = _json_body(request)
    if not data or "type" not in data:
        return JsonResponse({"error": "missing_reaction_type"}, status=400)

    try:
        result = feed_service.toggle_reaction(post_id, acc, data["type"])
        return JsonResponse(result)
    except ValueError as e:
        msg = str(e)
        if msg == "post_not_found":
            return JsonResponse({"error": "not_found"}, status=404)
        return JsonResponse({"error": msg}, status=400)


@csrf_exempt
def participant_feed_comments_view(request: HttpRequest, post_id: int):
    """GET: list comments for post. POST: add comment to post."""
    acc, _team, err = _require_approved_team(request)
    if err:
        return err

    if request.method == "GET":
        try:
            limit = min(100, max(1, int(request.GET.get("limit", 50))))
            offset = max(0, int(request.GET.get("offset", 0)))
        except (ValueError, TypeError):
            limit = 50
            offset = 0

        comments, total = feed_service.list_comments(post_id, limit=limit, offset=offset)
        team_map = _build_team_map(comments)
        payload = [_format_comment(c, team_map, acc) for c in comments]

        return JsonResponse({
            "comments": payload,
            "total": total,
            "limit": limit,
            "offset": offset,
        })

    if request.method == "POST":
        data = _json_body(request)
        body = data.get("body") if data else ""
        try:
            comment = feed_service.create_comment(post_id, acc, body)
            team_map = _build_team_map([comment])
            return JsonResponse(
                {"comment": _format_comment(comment, team_map, acc)},
                status=201,
            )
        except ValueError as e:
            msg = str(e)
            if msg == "post_not_found":
                return JsonResponse({"error": "not_found"}, status=404)
            return JsonResponse({"error": msg}, status=400)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def participant_feed_delete_comment_view(request: HttpRequest, post_id: int, comment_id: int):
    """DELETE /api/feed/<id>/comments/<cid>: participant deletes own comment."""
    if request.method != "DELETE":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, _team, err = _require_approved_team(request)
    if err:
        return err

    try:
        feed_service.delete_comment(comment_id, acc)
        return JsonResponse({"ok": True})
    except ValueError:
        return JsonResponse({"error": "not_found"}, status=404)
    except PermissionError:
        return JsonResponse({"error": "forbidden"}, status=403)


# =====================================================================
# Admin Endpoints
# =====================================================================

@csrf_exempt
def admin_feed_list_create_view(request: HttpRequest):
    """GET: list all posts (including drafts). POST: create a post."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        try:
            limit = min(100, max(1, int(request.GET.get("limit", 20))))
            offset = max(0, int(request.GET.get("offset", 0)))
        except (ValueError, TypeError):
            limit = 20
            offset = 0

        posts, total = feed_service.list_all_posts(limit=limit, offset=offset)
        post_ids = [p.id for p in posts]

        reactions_map = feed_service.bulk_reaction_summaries(post_ids, account=acc)
        comments_map = feed_service.bulk_comment_counts(post_ids)

        payload = [
            _format_post(p, reactions_map.get(p.id, {}), comments_map.get(p.id, 0))
            for p in posts
        ]

        return JsonResponse({
            "posts": payload,
            "total": total,
            "limit": limit,
            "offset": offset,
        })

    if request.method == "POST":
        data = _json_body(request) or {}
        try:
            post = feed_service.create_post(
                author=acc,
                title=data.get("title", ""),
                body=data.get("body", ""),
                cover_image_url=data.get("cover_image_url", ""),
                status=data.get("status", FeedPost.STATUS_DRAFT),
                is_pinned=data.get("is_pinned", False),
            )
            reactions = feed_service.get_reaction_summary(post.id, account=acc)
            return JsonResponse(
                {"post": _format_post(post, reactions, 0)},
                status=201,
            )
        except ValueError as e:
            return JsonResponse({"error": str(e)}, status=400)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def admin_feed_detail_update_delete_view(request: HttpRequest, post_id: int):
    """GET: post details. PUT: update post. DELETE: delete post."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        post = FeedPost.objects.filter(id=post_id).select_related("author").first()
        if not post:
            return JsonResponse({"error": "not_found"}, status=404)

        reactions = feed_service.get_reaction_summary(post.id, account=acc)
        comment_count = feed_service.get_comment_count(post.id)
        return JsonResponse({"post": _format_post(post, reactions, comment_count)})

    if request.method == "PUT":
        data = _json_body(request) or {}
        try:
            post = feed_service.update_post(post_id, **data)
            reactions = feed_service.get_reaction_summary(post.id, account=acc)
            comment_count = feed_service.get_comment_count(post.id)
            return JsonResponse({"post": _format_post(post, reactions, comment_count)})
        except ValueError as e:
            msg = str(e)
            if msg == "post_not_found":
                return JsonResponse({"error": "not_found"}, status=404)
            return JsonResponse({"error": msg}, status=400)

    if request.method == "DELETE":
        try:
            feed_service.delete_post(post_id)
            return JsonResponse({"ok": True})
        except ValueError:
            return JsonResponse({"error": "not_found"}, status=404)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def admin_feed_toggle_pin_view(request: HttpRequest, post_id: int):
    """POST /api/admin/feed/<id>/pin: toggle pinned status."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    try:
        post = feed_service.toggle_pin(post_id)
        return JsonResponse({"ok": True, "is_pinned": post.is_pinned})
    except ValueError:
        return JsonResponse({"error": "not_found"}, status=404)


@csrf_exempt
def admin_feed_upload_image_view(request: HttpRequest):
    """POST /api/admin/feed/upload-image: upload an image for post cover or body."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    uploaded_file = request.FILES.get("image") or request.FILES.get("file")
    if not uploaded_file:
        return JsonResponse({"error": "missing_file"}, status=400)

    post_id = request.POST.get("post_id")
    try:
        post_id_val = int(post_id) if post_id else None
    except (ValueError, TypeError):
        post_id_val = None

    try:
        feed_img = feed_service.upload_feed_image(uploaded_file, author=acc, post_id=post_id_val)
        return JsonResponse({
            "id": feed_img.id,
            "url": feed_img.image_url,
        })
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)


@csrf_exempt
def admin_feed_delete_comment_view(request: HttpRequest, post_id: int, comment_id: int):
    """DELETE /api/admin/feed/<id>/comments/<cid>: admin delete any comment."""
    if request.method != "DELETE":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    try:
        feed_service.delete_comment(comment_id, acc)
        return JsonResponse({"ok": True})
    except ValueError:
        return JsonResponse({"error": "not_found"}, status=404)
