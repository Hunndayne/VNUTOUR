from __future__ import annotations

import copy
import io
import re
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

from django.conf import settings
from django.utils import timezone

from api.models import (
    AuditLog,
    EventCheckIn,
    ScoreEntry,
    StationSubmission,
    Team,
    TeamMembership,
)


SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
ET.register_namespace("x", SHEET_NS)
Q = lambda name: f"{{{SHEET_NS}}}{name}"


def _column_name(index: int) -> str:
    value = index + 1
    result = ""
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _clean_text(value) -> str:
    return re.sub(
        r"[\x00-\x08\x0B\x0C\x0E-\x1F]",
        "",
        str(value or ""),
    )


def _excel_serial(value: datetime) -> float:
    if timezone.is_aware(value):
        value = timezone.localtime(value).replace(tzinfo=None)
    epoch = datetime(1899, 12, 30)
    return (value - epoch).total_seconds() / 86400


def _set_cell_value(cell: ET.Element, value) -> None:
    for child in list(cell):
        cell.remove(child)
    if value is None:
        cell.attrib.pop("t", None)
        return
    if isinstance(value, datetime):
        cell.attrib.pop("t", None)
        node = ET.SubElement(cell, Q("v"))
        node.text = str(_excel_serial(value))
        return
    if isinstance(value, bool):
        value = "Có" if value else "Không"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        cell.attrib.pop("t", None)
        node = ET.SubElement(cell, Q("v"))
        node.text = str(value)
        return

    cell.set("t", "inlineStr")
    inline = ET.SubElement(cell, Q("is"))
    text = ET.SubElement(inline, Q("t"))
    text.text = _clean_text(value)


def _populate_data_sheet(xml_bytes: bytes, rows: list[list]) -> bytes:
    root = ET.fromstring(xml_bytes)
    sheet_data = root.find(Q("sheetData"))
    template_rows = list(sheet_data)
    header = copy.deepcopy(template_rows[0])
    style_row = template_rows[1] if len(template_rows) > 1 else None
    styles = {}
    if style_row is not None:
        for cell in style_row.findall(Q("c")):
            column = re.match(r"[A-Z]+", cell.get("r", ""))
            if column:
                styles[column.group(0)] = cell.get("s")

    sheet_data.clear()
    sheet_data.append(header)
    for row_index, values in enumerate(rows, start=2):
        row = ET.Element(Q("row"), {
            "r": str(row_index),
            "ht": "22",
            "customHeight": "1",
        })
        for column_index, value in enumerate(values):
            column = _column_name(column_index)
            attrs = {"r": f"{column}{row_index}"}
            if styles.get(column) is not None:
                attrs["s"] = styles[column]
            cell = ET.SubElement(row, Q("c"), attrs)
            _set_cell_value(cell, value)
        sheet_data.append(row)

    sheet_view = root.find(f"{Q('sheetViews')}/{Q('sheetView')}")
    if sheet_view is not None and sheet_view.find(Q("pane")) is None:
        ET.SubElement(sheet_view, Q("pane"), {
            "ySplit": "1",
            "topLeftCell": "A2",
            "activePane": "bottomLeft",
            "state": "frozen",
        })

    for existing in root.findall(Q("autoFilter")):
        root.remove(existing)
    last_column = _column_name(
        max(0, len(rows[0]) - 1) if rows else len(header.findall(Q("c"))) - 1,
    )
    auto_filter = ET.Element(Q("autoFilter"), {
        "ref": f"A1:{last_column}{max(1, len(rows) + 1)}",
    })
    insert_at = list(root).index(sheet_data) + 1
    root.insert(insert_at, auto_filter)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _populate_summary(xml_bytes: bytes, values: dict[str, object]) -> bytes:
    root = ET.fromstring(xml_bytes)
    cells = {
        cell.get("r"): cell
        for cell in root.findall(f".//{Q('c')}")
        if cell.get("r")
    }
    for reference, value in values.items():
        cell = cells.get(reference)
        if cell is not None:
            _set_cell_value(cell, value)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def build_operations_report(*, phase_key: str | None = None) -> bytes:
    teams = Team.objects.prefetch_related(
        "memberships__participant",
    ).order_by("code")
    team_rows = []
    for team in teams:
        memberships = list(team.memberships.all())
        if not memberships:
            team_rows.append([
                team.code,
                team.name,
                team.approval_status,
                team.is_late_registration,
                "",
                "",
                "",
                False,
            ])
            continue
        for membership in memberships:
            participant = membership.participant
            team_rows.append([
                team.code,
                team.name,
                team.approval_status,
                team.is_late_registration,
                participant.mssv,
                participant.full_name,
                participant.school or "",
                membership.is_captain,
            ])

    checkins = EventCheckIn.objects.select_related(
        "phase", "sub_event", "team", "scanner",
    ).prefetch_related("team__memberships__participant").order_by("-created_at")
    scores = ScoreEntry.objects.select_related(
        "phase", "sub_event", "team", "created_by",
    ).order_by("-created_at")
    submissions = StationSubmission.objects.select_related(
        "station__sub_event__phase",
        "team",
        "graded_by",
    ).order_by("-submitted_at", "-id")
    if phase_key:
        checkins = checkins.filter(phase__key=phase_key)
        scores = scores.filter(phase__key=phase_key)
        submissions = submissions.filter(station__sub_event__phase__key=phase_key)

    checkin_rows = []
    for checkin in checkins:
        members = "; ".join(
            f"{membership.participant.mssv} - {membership.participant.full_name} - {membership.participant.school or ''}"
            for membership in checkin.team.memberships.all()
        )
        checkin_rows.append([
            checkin.id,
            checkin.phase.key,
            checkin.sub_event.name,
            checkin.team.code,
            checkin.team.name,
            checkin.status,
            checkin.scanner.username if checkin.scanner else "",
            checkin.created_at,
            members,
        ])

    score_rows = [[
        entry.id,
        entry.phase.key,
        entry.sub_event.name,
        entry.team.code,
        entry.team.name,
        entry.kind,
        entry.points,
        entry.note or "",
        entry.created_by.username if entry.created_by else "",
        entry.created_at,
        entry.updated_at,
    ] for entry in scores]

    submission_rows = [[
        submission.id,
        submission.station.sub_event.phase.key,
        submission.station.sub_event.name,
        submission.station.name,
        submission.team.code,
        submission.team.name,
        submission.status,
        submission.is_correct,
        submission.score,
        submission.submitted_at,
        submission.graded_at,
        submission.graded_by.username if submission.graded_by else "",
    ] for submission in submissions]

    audit_rows = [[
        log.id,
        log.created_at,
        log.actor.username if log.actor else "",
        log.action,
        f"{log.target_type or ''} {log.target_id or ''}".strip(),
        log.summary,
        log.reversible,
        bool(log.undone_at),
    ] for log in AuditLog.objects.select_related("actor").all()[:10000]]

    template_path = Path(settings.REPORT_TEMPLATE_PATH)
    output = io.BytesIO()
    with zipfile.ZipFile(template_path, "r") as source, zipfile.ZipFile(
        output,
        "w",
        compression=zipfile.ZIP_DEFLATED,
    ) as target:
        for name in source.namelist():
            content = source.read(name)
            if name == "xl/worksheets/sheet1.xml":
                content = _populate_summary(content, {
                    "B4": timezone.now(),
                    "B5": Team.objects.count(),
                    "B6": TeamMembership.objects.count(),
                    "B7": EventCheckIn.objects.filter(
                        status=EventCheckIn.STATUS_ACTIVE,
                    ).count(),
                    "B8": ScoreEntry.objects.count(),
                })
            elif name == "xl/worksheets/sheet2.xml":
                content = _populate_data_sheet(content, team_rows)
            elif name == "xl/worksheets/sheet3.xml":
                content = _populate_data_sheet(content, checkin_rows)
            elif name == "xl/worksheets/sheet4.xml":
                content = _populate_data_sheet(content, score_rows)
            elif name == "xl/worksheets/sheet5.xml":
                content = _populate_data_sheet(content, submission_rows)
            elif name == "xl/worksheets/sheet6.xml":
                content = _populate_data_sheet(content, audit_rows)
            target.writestr(name, content)
    return output.getvalue()
