"""Link-shortener views — admin CRUD under `/api/admin/short-links`, plus the
public redirect served at `/s/<code>` (registered in serverapi/urls.py, not
under `/api/`, so short URLs stay as short as possible).

The redirect's error page is plain standalone HTML, not the SPA: a visitor
opening a dead link may have no session, and the SPA would flash its whole
shell just to say "link không tồn tại".
"""

from __future__ import annotations

import html

from django.http import HttpRequest, HttpResponse, HttpResponseRedirect, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, ShortLink
from api.services.audit_service import record_audit
from api.services.shortlink_service import (
    UNSET, create_link, list_links, record_click, resolve_link,
    serialize_link, update_link,
)
from .views_shared import _json_body, _require_role


def _get_link_or_404(link_id: int) -> tuple[ShortLink | None, JsonResponse | None]:
    try:
        return ShortLink.objects.get(pk=link_id), None
    except ShortLink.DoesNotExist:
        return None, JsonResponse({"error": "not_found"}, status=404)


# =====================================================================
# Admin CRUD
# =====================================================================

@csrf_exempt
def admin_short_links_view(request: HttpRequest):
    """GET: list all short links. POST: create one."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        return JsonResponse({"links": list_links()})

    if request.method == "POST":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        try:
            link = create_link(
                target_url=data.get("target_url"),
                code=data.get("code") or None,
                label=data.get("label") or "",
                expires_at=data.get("expires_at"),
                account=acc,
            )
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)

        record_audit(
            actor=acc,
            action="shortlink.create",
            summary=f"Tạo link rút gọn /s/{link.code}",
            target_type="ShortLink",
            target_id=link.id,
            after_data={"code": link.code, "target_url": link.target_url},
            reversible=False,
        )
        return JsonResponse(serialize_link(link, request), status=201)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def admin_short_link_detail_view(request: HttpRequest, link_id: int):
    """PATCH: update a link's target/label/code/expiry/active flag.
    DELETE: remove it (old /s/<code> starts returning 404)."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    link, err = _get_link_or_404(link_id)
    if err:
        return err

    if request.method == "PATCH":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        # The FE edit form always submits the expiry field (empty = clear);
        # anything absent from the payload keeps its stored value.
        expires = data["expires_at"] if "expires_at" in data else UNSET

        try:
            updated = update_link(
                link,
                target_url=data.get("target_url"),
                label=data.get("label"),
                is_active=data.get("is_active"),
                expires_at=expires,
                code=data.get("code") or None,
            )
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)

        record_audit(
            actor=acc,
            action="shortlink.update",
            summary=f"Cập nhật link rút gọn /s/{updated.code}",
            target_type="ShortLink",
            target_id=updated.id,
            after_data={
                "code": updated.code, "target_url": updated.target_url,
                "is_active": updated.is_active,
            },
            reversible=False,
        )
        return JsonResponse(serialize_link(updated, request))

    if request.method == "DELETE":
        code = link.code
        record_audit(
            actor=acc,
            action="shortlink.delete",
            summary=f"Xoá link rút gọn /s/{code}",
            target_type="ShortLink",
            target_id=link.id,
            before_data={"code": code, "target_url": link.target_url},
            reversible=False,
        )
        link.delete()
        return JsonResponse({"ok": True})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


# =====================================================================
# Public redirect
# =====================================================================

_GONE_MESSAGES = {
    "inactive": "Link này đã bị tắt.",
    "expired": "Link này đã hết hạn.",
}


def _error_page(message: str, status: int) -> HttpResponse:
    page = f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link không khả dụng — VNUTour</title>
<style>
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #f6f4ef; color: #20312e;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }}
  .card {{ text-align: center; padding: 2.5rem 2rem; max-width: 24rem; }}
  .code {{ font-size: 3rem; font-weight: 700; opacity: .18; }}
  p {{ margin: .75rem 0 1.5rem; line-height: 1.5; color: #45605a; }}
  a {{ display: inline-block; background: #20312e; color: #fff; text-decoration: none;
       padding: .65rem 1.5rem; border-radius: .5rem; font-weight: 600; }}
</style>
</head>
<body>
  <div class="card">
    <div class="code">{status}</div>
    <p>{html.escape(message)}</p>
    <a href="/">Về trang chủ VNUTour</a>
  </div>
</body>
</html>"""
    return HttpResponse(page, status=status)


def short_link_redirect_view(request: HttpRequest, code: str):
    """GET /s/<code> → 302 to the target (click counted), or a small HTML
    error page for unknown (404) / inactive / expired (410) links."""
    if request.method not in ("GET", "HEAD"):
        return HttpResponse(status=405)

    link, err = resolve_link(code)
    if err == "not_found":
        return _error_page("Link không tồn tại hoặc đã bị xoá.", 404)
    if err in _GONE_MESSAGES:
        return _error_page(_GONE_MESSAGES[err], 410)

    record_click(link)
    return HttpResponseRedirect(link.target_url)
