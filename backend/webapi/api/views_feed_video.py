from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.models import Account
from api.services import feed_video_service as videos
from api.views_shared import _json_body, _require_role


def _error(exc):
    if isinstance(exc, videos.VideoStorageError):
        return JsonResponse({"error": str(exc)}, status=503)
    return JsonResponse({"error": str(exc)}, status=404 if str(exc) == "video_not_found" else 400)


@csrf_exempt
def video_upload_view(request, video_id=None, part_number=None):
    account, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err
    try:
        if request.method == "POST" and video_id is None:
            data = _json_body(request) or {}
            video = videos.begin_upload(account, data.get("name"), data.get("size"))
            return JsonResponse({"video": videos.serialize_video(video), "part_size": videos.PART_BYTES}, status=201)
        if request.method == "POST" and part_number is not None:
            videos.upload_part(video_id, account, part_number, request.FILES.get("part"))
            return JsonResponse({"ok": True})
        if request.method == "POST" and video_id is not None:
            video = videos.complete_upload(video_id, account)
            return JsonResponse({"video": videos.serialize_video(video)})
        if request.method == "DELETE" and video_id is not None and part_number is None:
            videos.discard_upload(video_id, account)
            return JsonResponse({"ok": True})
    except (ValueError, videos.VideoStorageError) as exc:
        return _error(exc)
    return JsonResponse({"error": "method_not_allowed"}, status=405)
