import json
from pathlib import Path

from django.http import FileResponse, HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.models import Account
from api.services.audit_service import record_audit
from api.services.backup_service import (
    create_backup,
    get_backup_path,
    list_backups,
    restore_backup,
    save_uploaded_backup,
)
from .views_shared import _json_body, _require_role


@csrf_exempt
def backups_view(request: HttpRequest):
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err
    if request.method == "GET":
        return JsonResponse({"items": list_backups()})
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    result = create_backup(prefix="manual")
    record_audit(
        actor=acc,
        action="backup.create",
        summary=f"Tạo backup {result['filename']}",
        target_type="Backup",
        target_id=result["filename"],
        metadata={"size": result["size"], "counts": result["counts"]},
        reversible=False,
    )
    return JsonResponse(result, status=201)


def backup_download_view(request: HttpRequest, filename: str):
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    try:
        path = get_backup_path(filename)
    except (FileNotFoundError, ValueError):
        return JsonResponse({"error": "backup_not_found"}, status=404)
    return FileResponse(
        path.open("rb"),
        as_attachment=True,
        filename=path.name,
        content_type="application/zip",
    )


@csrf_exempt
def backup_restore_view(request: HttpRequest):
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    uploaded = request.FILES.get("file")
    temp_path = None
    if uploaded:
        confirmation = str(request.POST.get("confirmation") or "").strip()
        try:
            archive_path = save_uploaded_backup(uploaded)
            temp_path = archive_path
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
    else:
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        confirmation = str(data.get("confirmation") or "").strip()
        try:
            archive_path = get_backup_path(
                str(data.get("backup_name") or "").strip(),
            )
        except (FileNotFoundError, ValueError):
            return JsonResponse({"error": "backup_not_found"}, status=404)

    if confirmation != "RESTORE":
        if temp_path:
            temp_path.unlink(missing_ok=True)
        return JsonResponse({"error": "restore_confirmation_required"}, status=400)

    try:
        result = restore_backup(archive_path=archive_path, actor=acc)
    except (ValueError, json.JSONDecodeError) as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)

    restored_actor = result.pop("restored_actor")
    record_audit(
        actor=restored_actor,
        action="backup.restore",
        summary=f"Restore backup {archive_path.name}",
        target_type="Backup",
        target_id=archive_path.name,
        metadata={
            "safety_backup": result["safety_backup"]["filename"],
            "source_manifest": result["source_manifest"],
        },
        reversible=False,
    )
    return JsonResponse(result)
