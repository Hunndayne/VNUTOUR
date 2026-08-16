"""
Photo-frame overlay views — public gallery + downloads, admin CRUD (frames).
"""

from __future__ import annotations

from django.http import HttpRequest, JsonResponse
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, PhotoFrame
from api.services.photo_frame_service import (
    create_frame, delete_frame, frame_stats, list_admin_frames,
    list_public_frames, record_download, serialize_frame, update_frame,
)
from api.services.auth_service import find_by_token
from api.services.submission_storage_service import frame_file_response
from .views_shared import _client_ip, _consume_rate_limit, _extract_token, _json_body, _require_antibot, _require_role


TRUTHY = {"1", "true", "yes"}


def _get_frame_or_404(frame_id: int) -> tuple[PhotoFrame | None, JsonResponse | None]:
    try:
        return PhotoFrame.objects.get(pk=frame_id), None
    except PhotoFrame.DoesNotExist:
        return None, JsonResponse({"error": "not_found"}, status=404)


# =====================================================================
# Public
# =====================================================================

def public_frames_view(request: HttpRequest):
    """GET: list active frames for the public gallery."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    frames = [serialize_frame(f, request, admin=False) for f in list_public_frames()]
    return JsonResponse({"frames": frames})


def public_frame_image_view(request: HttpRequest, frame_id: int):
    """GET: stream a frame's image bytes (same-origin, avoids canvas-taint/CORS)."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    frame, err = _get_frame_or_404(frame_id)
    if err:
        return err

    resp = frame_file_response(frame.image)
    if resp is None:
        return JsonResponse({"error": "not_found"}, status=404)
    return resp


@csrf_exempt
def public_frame_download_view(request: HttpRequest, frame_id: int):
    """POST: record a successful compose + download of a frame."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    limited, _ = _consume_rate_limit(
        request,
        scope="frame-download",
        limit=settings.FRAME_DOWNLOAD_RATE_LIMIT,
        window_seconds=settings.FRAME_DOWNLOAD_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited
    # Body có thể rỗng (telemetry best-effort) — chỉ cần đọc được turnstile_token.
    blocked = _require_antibot(request, _json_body(request) or {})
    if blocked:
        return blocked

    frame, err = _get_frame_or_404(frame_id)
    if err:
        return err

    # Resolve caller identity here (views layer) and hand plain values to the
    # service, which stays free of request/token knowledge.
    token = _extract_token(request)
    account = find_by_token(token) if token else None
    count = record_download(frame, ip=_client_ip(request), account=account)
    return JsonResponse({"ok": True, "download_count": count})


# =====================================================================
# Admin
# =====================================================================

@csrf_exempt
def admin_frames_view(request: HttpRequest):
    """GET: list all frames. POST: upload a new frame (multipart)."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        frames = [serialize_frame(f, request, admin=True) for f in list_admin_frames()]
        return JsonResponse({"frames": frames})

    if request.method == "POST":
        uploaded = request.FILES.get("file")
        if not uploaded:
            return JsonResponse({"error": "missing_file"}, status=400)

        title = str(request.POST.get("title") or "").strip()
        if not title:
            return JsonResponse({"error": "missing_title"}, status=400)
        description = str(request.POST.get("description") or "").strip()
        is_active = str(request.POST.get("is_active") or "").strip().lower() in TRUTHY

        try:
            frame = create_frame(uploaded, title, description, is_active, acc)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)

        return JsonResponse(serialize_frame(frame, request, admin=True), status=201)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def admin_frame_detail_view(request: HttpRequest, frame_id: int):
    """PATCH: update a frame's fields and/or image. DELETE: remove it."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    frame, err = _get_frame_or_404(frame_id)
    if err:
        return err

    if request.method == "PATCH":
        uploaded = request.FILES.get("file")
        if uploaded:
            title = request.POST.get("title")
            description = request.POST.get("description")
            is_active_raw = request.POST.get("is_active")
            is_active = (
                str(is_active_raw).strip().lower() in TRUTHY
                if is_active_raw is not None else None
            )
            sort_order_raw = request.POST.get("sort_order")
            sort_order = int(sort_order_raw) if sort_order_raw not in (None, "") else None
        else:
            data = _json_body(request)
            if data is None:
                return JsonResponse({"error": "invalid_json"}, status=400)
            title = data.get("title")
            description = data.get("description")
            is_active = data.get("is_active")
            if is_active is not None:
                is_active = bool(is_active)
            sort_order = data.get("sort_order")
            if sort_order is not None:
                sort_order = int(sort_order)

        try:
            frame = update_frame(
                frame,
                title=title,
                description=description,
                is_active=is_active,
                sort_order=sort_order,
                uploaded=uploaded,
            )
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)

        return JsonResponse(serialize_frame(frame, request, admin=True))

    if request.method == "DELETE":
        delete_frame(frame)
        return JsonResponse({"ok": True})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


def admin_frame_downloads_view(request: HttpRequest):
    """GET: download stats — total, per-frame counts, and recent log entries."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    try:
        limit = int(request.GET.get("limit") or 50)
    except (TypeError, ValueError):
        limit = 50

    return JsonResponse(frame_stats(limit))
