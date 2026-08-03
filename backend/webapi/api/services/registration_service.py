"""
Registration service — schema-driven public registration (individual & team).

The form is admin-configurable: a `SystemSetting["registration_form_schema"]`
JSON holds the list of fields. The participant-facing page renders from this
schema, and submissions are validated/mapped here. Known keys map to first-class
Participant columns; everything else is stored in `Participant.extra`.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional, Tuple

from django.db import transaction

from api.models import (
    Account, Participant, Team, TeamMembership, SystemSetting, ProgramPhase,
)
from api.services import team_service


SCHEMA_KEY = "registration_form_schema"

# Person fields that are first-class Participant columns. Anything not listed
# here (but present in the schema) is written into Participant.extra.
PERSON_COLUMN_KEYS = {
    "full_name", "school", "faculty", "mssv", "email",
    "phone", "cccd", "date_of_birth", "facebook",
}

# School dropdown (from the org's master list). value = short code used by
# conditional logic (e.g. CCCD auto-fill for UIT); label = full display name.
SCHOOL_OPTIONS = [
    {"label": "Trường Đại học Bách khoa", "value": "HCMUT"},
    {"label": "Trường Đại học Công nghệ Thông tin", "value": "UIT"},
    {"label": "Trường Đại học Khoa học Tự nhiên", "value": "HCMUS"},
    {"label": "Trường Đại học Khoa học Xã hội và Nhân văn", "value": "HCMUSSH"},
    {"label": "Trường Đại học Kinh tế – Luật", "value": "UEL"},
    {"label": "Trường Đại học Quốc tế", "value": "HCMIU"},
    {"label": "Trường Đại học Khoa học Sức khoẻ", "value": "UHS"},
    {"label": "Đại học Quốc gia Thành phố Hồ Chí Minh", "value": "VNU-HCM"},
    {"label": "Trường Đại học Nông Lâm Thành phố Hồ Chí Minh", "value": "NLU"},
    {"label": "Trường Đại học Công nghệ Kỹ thuật Thành phố Hồ Chí Minh", "value": "HCMUTE"},
    {"label": "Trường Đại học Thể dục Thể thao Thành phố Hồ Chí Minh", "value": "USH"},
    {"label": "Trường Đại học Sư phạm Thể dục Thể thao Thành phố Hồ Chí Minh", "value": "HCMUPES"},
    {"label": "Đại học Kinh tế Thành phố Hồ Chí Minh", "value": "UEH"},
    {"label": "Trường Đại học Quốc tế RMIT Việt Nam", "value": "RMIT"},
    {"label": "Trường Đại học Fulbright Việt Nam", "value": "FUV"},
    {"label": "Trường Đại học Luật Thành phố Hồ Chí Minh", "value": "ULaw"},
    {"label": "Trường Đại học Mở Thành phố Hồ Chí Minh", "value": "HCMOU"},
    {"label": "Trường Đại học Sư phạm Thành phố Hồ Chí Minh", "value": "HCMUE"},
    {"label": "Trường Đại học Việt Đức", "value": "VGU"},
    {"label": "Đại học Y Dược Thành phố Hồ Chí Minh", "value": "YDS"},
    {"label": "Nhạc viện Thành phố Hồ Chí Minh", "value": "HCMCONS"},
    {"label": "Trường Đại học Sân khấu – Điện ảnh Thành phố Hồ Chí Minh", "value": "SKDAHCM"},
    {"label": "Trường Đại học Mỹ thuật Thành phố Hồ Chí Minh", "value": "HCMUFA"},
    {"label": "Trường Đại học Văn hóa Thành phố Hồ Chí Minh", "value": "VHS"},
    {"label": "Trường Đại học Công nghiệp Thành phố Hồ Chí Minh", "value": "IUH"},
    {"label": "Trường Đại học Công Thương Thành phố Hồ Chí Minh", "value": "HUIT"},
    {"label": "Trường Đại học Kiến trúc Thành phố Hồ Chí Minh", "value": "UAH"},
    {"label": "Trường Đại học Giao thông vận tải Thành phố Hồ Chí Minh", "value": "UTH"},
    {"label": "Học viện Hàng không Việt Nam", "value": "VAA"},
    {"label": "Trường Đại học Tài chính – Marketing", "value": "UFM"},
    {"label": "Trường Đại học Tài nguyên và Môi trường Thành phố Hồ Chí Minh", "value": "HCMUNRE"},
    {"label": "Trường Đại học Ngân hàng Thành phố Hồ Chí Minh", "value": "HUB"},
    {"label": "Trường Đại học Tôn Đức Thắng", "value": "TDTU"},
    {"label": "Trường Đại học Dầu khí Việt Nam", "value": "PVU"},
    {"label": "Học viện Phật giáo Việt Nam tại Thành phố Hồ Chí Minh", "value": "VBU"},
    {"label": "Học viện Công giáo Việt Nam", "value": "CIV"},
    {"label": "Viện Thánh kinh Thần học", "value": "IBT"},
    {"label": "Trường Kinh thánh Cơ Đốc", "value": "CBC"},
    {"label": "Học viện Cán bộ Thành phố Hồ Chí Minh", "value": "HCA"},
    {"label": "Trường Đại học Sài Gòn", "value": "SGU"},
    {"label": "Trường Đại học Y khoa Phạm Ngọc Thạch", "value": "PNTU"},
    {"label": "Trường Đại học Thủ Dầu Một", "value": "TDMU"},
    {"label": "Trường Đại học Công nghệ Sài Gòn", "value": "STU"},
    {"label": "Trường Đại học Công nghệ Thành phố Hồ Chí Minh", "value": "HUTECH"},
    {"label": "Trường Đại học Gia Định", "value": "GDU"},
    {"label": "Trường Đại học Hoa Sen", "value": "HSU"},
    {"label": "Trường Đại học Hùng Vương Thành phố Hồ Chí Minh", "value": "DHV"},
    {"label": "Trường Đại học Kinh tế – Tài chính Thành phố Hồ Chí Minh", "value": "UEF"},
    {"label": "Trường Đại học Ngoại ngữ – Tin học Thành phố Hồ Chí Minh", "value": "HUFLIT"},
    {"label": "Trường Đại học Nguyễn Tất Thành", "value": "NTTU"},
    {"label": "Trường Đại học Quản lý và Công nghệ Thành phố Hồ Chí Minh", "value": "UMT"},
    {"label": "Trường Đại học Quốc tế Hồng Bàng", "value": "HIU"},
    {"label": "Trường Đại học Quốc tế Sài Gòn", "value": "SIU"},
    {"label": "Trường Đại học Văn Hiến", "value": "VHU"},
    {"label": "Trường Đại học Văn Lang", "value": "VLU"},
    {"label": "Trường Đại học Bà Rịa – Vũng Tàu", "value": "BVU"},
    {"label": "Trường Đại học Bình Dương", "value": "BDU"},
    {"label": "Trường Đại học Kinh tế – Kỹ thuật Bình Dương", "value": "BETU"},
    {"label": "Trường Đại học Quốc tế Miền Đông", "value": "EIU"},
]

# Selecting this school code auto-fills CCCD with "UIT" and hides the input.
UIT_CODE = "UIT"


def default_schema() -> dict:
    """The 2025 form rebuilt as an editable schema. Used to seed the setting."""
    person_fields = [
        {"key": "full_name", "label": "Họ và tên", "type": "text", "required": True, "enabled": True},
        {"key": "school", "label": "Trường", "type": "select", "required": True, "enabled": True,
         "options": SCHOOL_OPTIONS, "allow_other": True},
        {"key": "faculty", "label": "Khoa", "type": "text", "required": True, "enabled": True},
        {"key": "mssv", "label": "MSSV", "type": "text", "required": True, "enabled": True},
        {"key": "email", "label": "Email", "type": "email", "required": True, "enabled": True},
        {"key": "phone", "label": "Số điện thoại", "type": "tel", "required": True, "enabled": True},
        {"key": "cccd", "label": "CCCD", "type": "text", "required": True, "enabled": True,
         "help": "Sinh viên trường ngoài vui lòng điền số CCCD.",
         # When school == UIT, this field is hidden and auto-set to "UIT".
         "conditional": {"watch": "school", "equals": UIT_CODE, "set": UIT_CODE, "hide": True}},
        {"key": "date_of_birth", "label": "Ngày sinh", "type": "date", "required": True, "enabled": True},
        {"key": "facebook", "label": "Link Facebook", "type": "text", "required": True, "enabled": True},
    ]
    return {
        "version": 1,
        "fee_note": "Lệ phí tham gia: 25.000 VNĐ/sinh viên.",
        "modes": ["individual", "team"],
        "team_size_min": 1,
        "team_size_max": 5,
        "person_fields": person_fields,
        "team_fields": [
            {"key": "team_name", "label": "Tên đội", "type": "text", "required": True, "enabled": True,
             "help": "Tên đội không dài quá 5 từ, lịch sự và vui vẻ.", "show_when_at_max_size": True},
            {"key": "payment_proof", "label": "Ảnh minh chứng thanh toán", "type": "file",
             "required": True, "enabled": True, "help": "Momo / Internet Banking."},
        ],
    }


def get_schema() -> dict:
    """Return the active schema, falling back to the default."""
    s = SystemSetting.objects.filter(key=SCHEMA_KEY).first()
    if s and isinstance(s.value, dict) and s.value.get("person_fields"):
        return s.value
    return default_schema()


def _enabled_person_fields(schema: dict) -> list[dict]:
    return [f for f in schema.get("person_fields", []) if f.get("enabled", True)]


def _apply_conditionals(fields: list[dict], data: dict) -> dict:
    """Return a shallow copy of data with conditional auto-fills applied.

    A field may declare {"conditional": {"watch": k, "equals": v, "set": x}} —
    when data[k] == v, the field is forced to x (and the FE hides its input).
    """
    result = dict(data)
    for f in fields:
        cond = f.get("conditional")
        if not cond:
            continue
        watched = result.get(cond["watch"])
        watched = watched.strip() if isinstance(watched, str) else watched
        if watched == cond.get("equals") and "set" in cond:
            result[f["key"]] = cond["set"]
    return result


def _is_hidden(field: dict, data: dict) -> bool:
    cond = field.get("conditional")
    if not cond or not cond.get("hide"):
        return False
    watched = data.get(cond["watch"])
    watched = watched.strip() if isinstance(watched, str) else watched
    return watched == cond.get("equals")


def _validate_person(schema: dict, data: dict, who: str) -> Tuple[dict, dict, Optional[str]]:
    """Split a person's submitted data into (columns, extra) and validate.

    `who` is a label for error messages (e.g. "captain", "member 2").
    Returns (columns, extra, error_code). error_code is None on success.
    """
    fields = _enabled_person_fields(schema)
    data = _apply_conditionals(fields, data)
    columns: dict = {}
    extra: dict = {}
    for f in fields:
        key = f["key"]
        raw = data.get(key)
        value = raw.strip() if isinstance(raw, str) else raw
        # A field hidden by a conditional is not required from the user.
        if f.get("required") and not value and not _is_hidden(f, data):
            return {}, {}, f"missing:{who}:{key}"
        if value in (None, ""):
            continue
        if key == "date_of_birth":
            value = _normalize_date(value)
            if value is None:
                return {}, {}, f"invalid_date:{who}:{key}"
        if key in PERSON_COLUMN_KEYS:
            columns[key] = value
        else:
            extra[key] = value
    if not columns.get("mssv"):
        return {}, {}, f"missing:{who}:mssv"
    return columns, extra, None


def validate_person_submission(data: dict, who: str = "participant") -> Tuple[dict, dict, Optional[str]]:
    """Validate one person against the active registration schema."""
    return _validate_person(get_schema(), data or {}, who)


def _normalize_date(value) -> Optional[date]:
    """Accept YYYY-MM-DD (HTML date input) and return a date object."""
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


def _upsert_participant(columns: dict, extra: dict) -> Tuple[Optional[Participant], Optional[str]]:
    """Create/update a Participant by mssv, guarding against cross-team reuse.

    Registration is unauthenticated, so the mssv alone cannot be treated as proof
    of identity: anyone who knows a student code could otherwise overwrite that
    person's record — name, email, phone — and then claim the account. When a
    record already exists, the submitted email has to match the stored one. A
    record the organisers preloaded without an email has nothing to match
    against, so it stays claimable.
    """
    mssv = columns["mssv"]
    existing = TeamMembership.objects.filter(participant__mssv=mssv).first()
    if existing:
        return None, f"mssv_in_other_team:{mssv}"

    known = Participant.objects.filter(mssv=mssv).only("id", "email").first()
    if known:
        stored_email = (known.email or "").strip().lower()
        supplied_email = str(columns.get("email") or "").strip().lower()
        if stored_email and stored_email != supplied_email:
            return None, f"mssv_email_mismatch:{mssv}"

    defaults = {k: v for k, v in columns.items() if k != "mssv"}
    if extra:
        defaults["extra"] = extra
    participant, _ = Participant.objects.update_or_create(mssv=mssv, defaults=defaults)
    return participant, None


def register_individual(data: dict) -> Tuple[Optional[Participant], Optional[str]]:
    """Register a single participant (BTC assigns a team later)."""
    schema = get_schema()
    columns, extra, err = _validate_person(schema, data, "individual")
    if err:
        return None, err
    return _upsert_participant(columns, extra)


def register_team(data: dict) -> Tuple[Optional[Team], Optional[str]]:
    """Register a full team: captain + members, all keyed by MSSV.

    Expected `data`:
      { "team_name": str, "payment_proof": str|None,
        "captain": {person fields...}, "members": [ {person fields...}, ... ] }
    """
    schema = get_schema()
    team_name = (data.get("team_name") or "").strip()
    current_phase = ProgramPhase.objects.filter(is_current=True).first()
    is_late_registration = bool(current_phase and current_phase.key != "registration")

    captain_data = data.get("captain") or {}
    members_data = data.get("members") or []

    # Validate everyone up front so we don't create a half-built team.
    cap_cols, cap_extra, err = _validate_person(schema, captain_data, "captain")
    if err:
        return None, err
    validated_members = []
    for i, m in enumerate(members_data, start=2):
        cols, ex, err = _validate_person(schema, m, f"member_{i}")
        if err:
            return None, err
        validated_members.append((cols, ex))

    # Enforce team size range from schema (captain + members).
    min_size = schema.get("team_size_min", 1) if isinstance(schema, dict) else 1
    max_size = schema.get("team_size_max", 5) if isinstance(schema, dict) else 5
    total_members = len(validated_members) + 1
    if total_members < min_size or total_members > max_size:
        return None, f"team_size_out_of_range:{min_size}-{max_size}"
    # Naming is reserved for full teams: an under-strength team is still going to
    # be merged with others by the organisers, so whatever it called itself would
    # not survive anyway.
    if total_members == max_size and not team_name:
        return None, "missing:team:team_name"
    if total_members < max_size and team_name:
        return None, f"team_name_requires_full_team:{max_size}"
    if not team_name:
        team_name = f"Pending team {cap_cols['mssv']}"

    # Reject duplicate MSSV within the same submission.
    all_mssv = [cap_cols["mssv"]] + [c["mssv"] for c, _ in validated_members]
    if len(set(all_mssv)) != len(all_mssv):
        return None, "duplicate_mssv_in_team"

    try:
        with transaction.atomic():
            team, err = team_service.create_team(
                team_name,
                is_late_registration=is_late_registration,
            )
            if err:
                raise _Rollback(err)
            if data.get("payment_proof"):
                team.payment_proof = data["payment_proof"]
                team.save(update_fields=["payment_proof", "updated_at"])

            # Captain first.
            p, err = _upsert_participant(cap_cols, cap_extra)
            if err:
                raise _Rollback(err)
            _attach(team, p, is_captain=True)

            for cols, ex in validated_members:
                p, err = _upsert_participant(cols, ex)
                if err:
                    raise _Rollback(err)
                _attach(team, p, is_captain=False)

            team.approval_status = Team.APPROVAL_PENDING
            team.submitted_at = datetime.now(timezone.utc)
            team.save(update_fields=[
                "approval_status", "submitted_at", "is_late_registration", "updated_at",
            ])
    except _Rollback as r:
        return None, r.code

    return team, None


class _Rollback(Exception):
    """Internal: abort the atomic block and surface an error code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def lookup_participant(mssv: str, email: str) -> dict:
    """Privacy-safe lookup for the signup page.

    Two-layer match: an existing participant is only revealed when BOTH the
    MSSV and the email match what was registered. Sensitive fields (CCCD, phone,
    date of birth, facebook) are NEVER returned — only basic recognition info.

    Returns one of:
      {"status": "not_found"}
      {"status": "email_mismatch"}
      {"status": "match", "full_name", "school", "faculty"}
    """
    mssv = (mssv or "").strip()
    email = (email or "").strip()
    if not mssv:
        return {"status": "not_found"}

    p = Participant.objects.filter(mssv=mssv).first()
    if not p:
        return {"status": "not_found"}

    # MSSV exists but the email doesn't line up — do not reveal anything.
    if not email or not p.email or p.email.strip().lower() != email.lower():
        return {"status": "email_mismatch"}

    return {
        "status": "match",
        "full_name": p.full_name or "",
        "school": p.school or "",
        "faculty": p.faculty or "",
    }


def validate_account_mssv_claim(account: Account, mssv: str) -> Optional[str]:
    """Return an error code if an account is not allowed to claim this MSSV."""
    mssv = (mssv or "").strip()
    if not account or not mssv:
        return None

    participant = Participant.objects.filter(mssv=mssv).only(
        "id", "account_id", "email",
    ).first()
    if not participant:
        return None

    if participant.account_id == account.id:
        return None
    if participant.account_id and participant.account_id != account.id:
        return "mssv_taken"
    if (
        participant.email
        and account.email
        and participant.email.strip().lower() != account.email.strip().lower()
    ):
        return "registration_mismatch"
    return None


def _attach(team: Team, participant: Participant, is_captain: bool) -> None:
    TeamMembership.objects.update_or_create(
        participant=participant,
        defaults={"team": team},
    )
    if is_captain:
        m = TeamMembership.objects.get(participant=participant)
        if not m.is_captain:
            m.is_captain = True
            m.save(update_fields=["is_captain", "updated_at"])
