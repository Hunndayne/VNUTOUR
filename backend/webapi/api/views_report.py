from datetime import datetime

from django.http import HttpRequest, HttpResponse, JsonResponse

from api.models import Account
from api.services.audit_service import record_audit
from api.services.report_service import build_operations_report
from .views_shared import _require_role


def report_export_view(request: HttpRequest):
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    phase_key = str(request.GET.get("phase") or "").strip() or None
    content = build_operations_report(phase_key=phase_key)
    filename = f"vnutour-report-{datetime.now():%Y%m%d-%H%M%S}.xlsx"
    record_audit(
        actor=acc,
        action="report.export",
        summary=f"Xuất báo cáo XLSX{f' cho phase {phase_key}' if phase_key else ''}",
        target_type="Report",
        metadata={"phase_key": phase_key, "filename": filename},
        reversible=False,
    )
    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
