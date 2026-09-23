import hmac
import io

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .constants import MODEL_VERSION
from .engine import get_engine
from .errors import GalleryError
from .imaging import read_image


@require_GET
def live(request):
    return JsonResponse({"ok": True})


@require_GET
def ready(request):
    try:
        get_engine()
        return JsonResponse({"ok": True, "model_version": MODEL_VERSION})
    except Exception:
        return JsonResponse({"error": "model_unavailable"}, status=503)


@csrf_exempt
@require_POST
def embed(request):
    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    if not settings.PHOTO_AI_TOKEN or not hmac.compare_digest(token, settings.PHOTO_AI_TOKEN):
        return JsonResponse({"error": "forbidden"}, status=403)
    try:
        if int(request.META.get("CONTENT_LENGTH") or 0) > settings.PHOTO_REFERENCE_MAX_BYTES:
            raise GalleryError("reference_too_large")
        data = request.read(settings.PHOTO_REFERENCE_MAX_BYTES + 1)
        if len(data) > settings.PHOTO_REFERENCE_MAX_BYTES:
            raise GalleryError("reference_too_large")
        faces = get_engine().extract(read_image(io.BytesIO(data)), reference=True)
        return JsonResponse({"embedding": faces[0]["embedding"], "model_version": MODEL_VERSION})
    except GalleryError as exc:
        return JsonResponse({"error": exc.code}, status=503 if exc.retryable or exc.code == "model_unavailable" else 400)
    except Exception:
        return JsonResponse({"error": "search_unavailable"}, status=503)
