"""
Score & advancement views — §9.8.
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, ScoreEntry, ProgramPhase, SubEvent, Team, AdvancementRule
from api.services.score_service import (
    get_phase_scoreboard, create_score_entry,
    update_score_entry, delete_score_entry,
    set_advancement_rule, publish_advancement,
)
from api.services.team_service import _get_setting
from api.services.audit_service import record_audit, serialize_score_entry
from .views_shared import _json_body, _auth_or_401, _require_role


def phase_scoreboard_view(request: HttpRequest, phase_key: str):
    """GET: full scoreboard for a phase."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    try:
        data = get_phase_scoreboard(phase_key)
        return JsonResponse(data)
    except ProgramPhase.DoesNotExist:
        return JsonResponse({"error": "phase_not_found"}, status=404)


@csrf_exempt
def score_entry_create_view(request: HttpRequest):
    """POST: create a score entry (manual/bonus/penalty)."""
    acc, err = _auth_or_401(request)
    if err:
        return err

    # Collab may be allowed if setting permits
    if acc.role == Account.ROLE_COLLAB and not _get_setting("collab_can_edit_scores"):
        return JsonResponse({"error": "forbidden"}, status=403)
    if acc.role not in (Account.ROLE_ADMIN, Account.ROLE_COLLAB):
        return JsonResponse({"error": "forbidden"}, status=403)

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    phase_key = str((data.get("phaseKey") or data.get("phase_key") or "").strip())
    event_id = data.get("eventId") or data.get("event_id")
    team_code = str((data.get("teamCode") or data.get("team_code") or "").strip())
    kind = str((data.get("kind") or "").strip())
    points = data.get("points", 0)

    if not all([phase_key, event_id, team_code, kind]):
        return JsonResponse({"error": "missing_fields"}, status=400)
    if kind not in ("bonus", "penalty", "manual"):
        return JsonResponse({"error": "invalid_kind"}, status=400)

    try:
        entry = create_score_entry(
            phase_key=phase_key,
            event_id=int(event_id),
            team_code=team_code,
            kind=kind,
            points=int(points),
            created_by=acc,
            note=data.get("note"),
        )
        record_audit(
            actor=acc,
            action="score.create",
            summary=f"Tạo điểm {entry.kind} cho đội {entry.team.code}: {entry.points:+d}",
            target_type="ScoreEntry",
            target_id=entry.id,
            after_data=serialize_score_entry(entry),
            reversible=True,
        )
        return JsonResponse({
            "id": entry.id, "team_code": entry.team.code,
            "kind": entry.kind, "points": entry.points,
        }, status=201)
    except ProgramPhase.DoesNotExist:
        return JsonResponse({"error": "phase_not_found"}, status=404)
    except SubEvent.DoesNotExist:
        return JsonResponse({"error": "event_not_found"}, status=404)
    except Team.DoesNotExist:
        return JsonResponse({"error": "team_not_found"}, status=404)
    except ValueError as exc:
        if str(exc) == "results_locked":
            return JsonResponse({"error": "results_locked"}, status=409)
        if str(exc) == "team_not_in_phase":
            return JsonResponse({"error": "team_not_in_phase"}, status=403)
        return JsonResponse({"error": "invalid_points"}, status=400)
    except TypeError:
        return JsonResponse({"error": "invalid_points"}, status=400)


@csrf_exempt
def score_entry_detail_view(request: HttpRequest, entry_id: int):
    """PATCH/DELETE a score entry."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "PATCH":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        try:
            before_entry = ScoreEntry.objects.get(id=entry_id)
            before = serialize_score_entry(before_entry)
            entry = update_score_entry(
                entry_id,
                points=data.get("points"),
                note=data.get("note"),
            )
            record_audit(
                actor=acc,
                action="score.update",
                summary=f"Sửa điểm #{entry.id} của đội {entry.team.code}",
                target_type="ScoreEntry",
                target_id=entry.id,
                before_data=before,
                after_data=serialize_score_entry(entry),
                reversible=True,
            )
            return JsonResponse({
                "id": entry.id, "kind": entry.kind, "points": entry.points,
            })
        except ScoreEntry.DoesNotExist:
            return JsonResponse({"error": "not_found"}, status=404)
        except ValueError as exc:
            if str(exc) == "results_locked":
                return JsonResponse({"error": "results_locked"}, status=409)
            return JsonResponse({"error": "invalid_points"}, status=400)

    if request.method == "DELETE":
        try:
            entry = ScoreEntry.objects.get(id=entry_id)
            before = serialize_score_entry(entry)
            delete_score_entry(entry_id)
            record_audit(
                actor=acc,
                action="score.delete",
                summary=f"Xóa điểm #{entry_id}",
                target_type="ScoreEntry",
                target_id=entry_id,
                before_data=before,
                reversible=True,
            )
            return JsonResponse({"status": "deleted"})
        except ScoreEntry.DoesNotExist:
            return JsonResponse({"error": "not_found"}, status=404)
        except ValueError as exc:
            if str(exc) == "results_locked":
                return JsonResponse({"error": "results_locked"}, status=409)
            return JsonResponse({"error": "invalid_points"}, status=400)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def advancement_rule_view(request: HttpRequest, phase_key: str):
    """GET/PUT: read or configure advancement rule."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        try:
            phase = ProgramPhase.objects.get(key=phase_key)
        except ProgramPhase.DoesNotExist:
            return JsonResponse({"error": "phase_not_found"}, status=404)

        next_phase = ProgramPhase.objects.filter(order__gt=phase.order).order_by("order").first()
        rule = AdvancementRule.objects.select_related("to_phase", "published_by").filter(
            from_phase=phase,
        ).first()
        return JsonResponse({
            "from_phase": phase.key,
            "to_phase": rule.to_phase.key if rule else (next_phase.key if next_phase else None),
            "to_phase_label": rule.to_phase.label if rule else (next_phase.label if next_phase else None),
            "mode": rule.mode if rule else AdvancementRule.MODE_TOP_N,
            "slots": rule.slots if rule else 0,
            "last_published_at": rule.last_published_at.isoformat() if rule and rule.last_published_at else None,
            "published_by": rule.published_by.username if rule and rule.published_by else None,
        })

    if request.method != "PUT":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    to_phase_key = str((data.get("toPhaseKey") or data.get("to_phase_key") or "").strip())
    if not to_phase_key:
        return JsonResponse({"error": "missing_to_phase"}, status=400)

    try:
        rule = set_advancement_rule(
            from_phase_key=phase_key,
            to_phase_key=to_phase_key,
            mode=data.get("mode", "top_n"),
            slots=int(data.get("slots", 0)),
        )
        return JsonResponse({
            "from_phase": rule.from_phase.key,
            "to_phase": rule.to_phase.key,
            "mode": rule.mode,
            "slots": rule.slots,
        })
    except ProgramPhase.DoesNotExist:
        return JsonResponse({"error": "phase_not_found"}, status=404)
    except ValueError as exc:
        if str(exc) == "results_locked":
            return JsonResponse({"error": "results_locked"}, status=409)
        if str(exc) == "invalid_mode":
            return JsonResponse({"error": "invalid_mode"}, status=400)
        return JsonResponse({"error": "invalid_slots"}, status=400)
    except TypeError:
        return JsonResponse({"error": "invalid_slots"}, status=400)


@csrf_exempt
def publish_advancement_view(request: HttpRequest, phase_key: str):
    """POST: publish advancement — promote teams to next phase."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    try:
        data = _json_body(request) or {}
        manual_team_codes = data.get("manual_team_codes") or data.get("manualTeamCodes") or []
        result = publish_advancement(phase_key, acc, manual_team_codes=manual_team_codes)
        return JsonResponse(result)
    except ProgramPhase.DoesNotExist:
        return JsonResponse({"error": "phase_not_found"}, status=404)
    except ValueError as e:
        status = 409 if str(e) == "results_locked" else 400
        return JsonResponse({"error": str(e)}, status=status)
