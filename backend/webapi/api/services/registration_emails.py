"""Automated transactional emails around public registration.

Two triggers:
  - Email 1 ("registration received") — fired at the end of
    `registration_service.register_individual` / `register_team`.
  - Email 2 ("team approved") — fired inside `team_service.approve_team`,
    which is the single choke point both the collection PATCH and the
    dedicated approve endpoint route through.

Each is split into a pure `_..._body()` builder (easy to unit test without
touching the queue) and a `send_...()` wrapper that renders the full branded
email and enqueues it. Enqueue failures are logged and swallowed — a mail
outage must never break registration or approval.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.utils.html import escape

from api.models import Account, Participant, Team, TeamMembership
from api.services.email_service import enqueue_email_messages
from api.services.email_templates import (
    email_cta_button, email_paragraph, render_branded_email,
)

logger = logging.getLogger(__name__)

SUBJECT_REGISTRATION_RECEIVED = "[VNU Tour 2026] Xác nhận tiếp nhận thông tin đăng ký"


def _member_lines(members: list[tuple[str, str]]) -> str:
    return "<br/>".join(
        f"• {escape(name)} — MSSV: {escape(mssv)}" for name, mssv in members
    )


def _registration_received_body(*, ten: str, members: list[tuple[str, str]]) -> str:
    """Pure builder for Email 1's body_html. `members` is [(full_name, mssv), ...]."""
    ten_esc = escape(ten)
    return "".join([
        email_paragraph(f"Chào <strong>{ten_esc}</strong>,"),
        email_paragraph(
            "Cảm ơn bạn đã quan tâm và đăng ký tham gia <strong>VNU Tour 2026</strong>. "
            "Ban Tổ chức (BTC) xác nhận đã tiếp nhận thành công thông tin của bạn."
        ),
        email_paragraph(
            "<strong>Chi tiết thông tin đăng ký:</strong><br/>" + _member_lines(members)
        ),
        email_paragraph(
            "BTC đang tiến hành kiểm tra và duyệt thông tin đăng ký trong thời gian sớm nhất. "
            "Các cá nhân hoặc nhóm chưa đủ 5 người sẽ được BTC <strong>ghép đội ngẫu nhiên</strong> "
            "và thông báo kết quả chi tiết qua email."
        ),
        email_paragraph("<strong>Tạo tài khoản trên Website chương trình</strong>"),
        email_paragraph(
            "Để chuẩn bị cho các vòng thi sắp tới, tất cả thành viên vui lòng "
            "<strong>tạo tài khoản trên website vnutour.suctremmt.com</strong> bằng đúng "
            "<strong>MSSV và Email</strong> đã đăng ký với BTC. Nếu phát hiện sai sót thông tin, "
            "vui lòng liên hệ BTC qua email <strong>vnutour@suctremmt.com</strong> để được hỗ trợ "
            "điều chỉnh."
        ),
        email_paragraph("<strong>Tham gia Discord</strong>"),
        email_paragraph(
            "Kênh trao đổi chung của chương trình sẽ diễn ra trên nền tảng <strong>Discord</strong>. "
            "Bạn và các thành viên vui lòng tạo tài khoản Discord ngay từ bây giờ (nếu chưa có). "
            "Link tham gia sẽ sớm được gửi tới bạn để hỗ trợ giao lưu, giải đáp thắc mắc và cập nhật "
            "tin tức nhanh nhất."
        ),
        email_paragraph(
            "Bạn lưu ý theo dõi email thường xuyên (bao gồm cả hộp thư <strong>Spam/Quảng cáo</strong>) "
            "để không bỏ lỡ các thông báo tiếp theo."
        ),
        email_paragraph(
            "Chúc bạn sẵn sàng bùng nổ, thể hiện bản lĩnh và tạo nên những khoảnh khắc đáng nhớ "
            "cùng <strong>VNU Tour 2026!</strong>"
        ),
        email_paragraph("Trân trọng,<br/><strong>BTC VNU Tour 2026</strong>"),
    ])


def send_registration_received_individual(participant: Participant | None) -> None:
    """Email 1 for a lone registrant. Never raises."""
    try:
        if not participant or not participant.email:
            return
        body = _registration_received_body(
            ten=participant.full_name or "",
            members=[(participant.full_name or "", participant.mssv or "")],
        )
        html_body = render_branded_email(
            title="XÁC NHẬN TIẾP NHẬN ĐĂNG KÝ", body_html=body,
        )
        enqueue_email_messages(
            messages=[{
                "to_emails": [participant.email],
                "subject": SUBJECT_REGISTRATION_RECEIVED,
                "html_body": html_body,
            }],
            created_by=None,
        )
    except Exception:
        logger.exception(
            "Failed to enqueue registration-received email for participant %s",
            getattr(participant, "mssv", None),
        )


def send_registration_received_team(team: Team | None) -> None:
    """Email 1 for a team registration: To=captain, CC=other members. Never raises."""
    try:
        if not team:
            return
        memberships = list(
            TeamMembership.objects.filter(team=team)
            .select_related("participant")
            .order_by("-is_captain", "id")
        )
        if not memberships:
            return
        captain_membership = next((m for m in memberships if m.is_captain), memberships[0])
        captain = captain_membership.participant
        if not captain.email:
            return

        members = [
            (m.participant.full_name or "", m.participant.mssv or "") for m in memberships
        ]
        cc_emails = [
            m.participant.email for m in memberships
            if m.participant_id != captain.id and m.participant.email
        ]

        body = _registration_received_body(ten=captain.full_name or "", members=members)
        html_body = render_branded_email(
            title="XÁC NHẬN TIẾP NHẬN ĐĂNG KÝ", body_html=body,
        )
        enqueue_email_messages(
            messages=[{
                "to_emails": [captain.email],
                "cc_emails": cc_emails,
                "subject": SUBJECT_REGISTRATION_RECEIVED,
                "html_body": html_body,
            }],
            created_by=None,
        )
    except Exception:
        logger.exception(
            "Failed to enqueue registration-received email for team %s",
            getattr(team, "code", None),
        )


def _has_account(participant: Participant) -> bool:
    if participant.mssv and Account.objects.filter(mssv=participant.mssv).exists():
        return True
    if participant.email and Account.objects.filter(email__iexact=participant.email).exists():
        return True
    return False


def _team_approved_body(
    *, ten: str, team_name: str,
    unregistered: list[tuple[str, str, str]],
    discord_invite_url: str,
) -> str:
    """Pure builder for Email 2's body_html.

    `unregistered` is [(full_name, mssv, email), ...] for members with no
    matching website Account; an empty list drops the account-creation task
    and renumbers the remaining two.
    """
    ten_esc = escape(ten)
    team_esc = escape(team_name)
    has_unregistered = bool(unregistered)
    total_tasks = 3 if has_unregistered else 2

    parts = [
        email_paragraph(
            f"Chào <strong>{ten_esc}</strong> và các thành viên đội <strong>{team_esc}</strong>,"
        ),
        email_paragraph(
            "Chúc mừng bạn! Ban Tổ chức <strong>VNU Tour 2026</strong> xin thông báo đội "
            f"<strong>{team_esc}</strong> của bạn đã chính thức <strong>được duyệt hồ sơ</strong> và "
            "sẵn sàng bước vào hành trình \"Khám phá khu đô thị ĐHQG-HCM\"."
        ),
        email_paragraph(
            "Để chuẩn bị tốt nhất cho Vòng loại sắp tới, bạn và các thành viên vui lòng hoàn thành "
            f"<strong>{total_tasks}</strong> nhiệm vụ quan trọng sau theo đúng trình tự:"
        ),
    ]

    next_num = 1
    if has_unregistered:
        parts.append(email_paragraph(
            "<strong>1️⃣ Hoàn tất tạo tài khoản trên Website chương trình</strong>"
        ))
        parts.append(email_paragraph(
            "Tất cả thành viên bắt buộc phải có tài khoản trên website "
            "<strong>vnutour.suctremmt.com</strong>. Việc chưa đăng ký tài khoản sẽ gây ảnh hưởng "
            "trực tiếp đến quyền lợi và điểm số của cả đội về sau."
        ))
        unregistered_lines = "<br/>".join(
            f"• {escape(name)} — MSSV: {escape(mssv)} — Email: {escape(email)}"
            for name, mssv, email in unregistered
        )
        parts.append(email_paragraph(
            "📌 Danh sách thành viên <strong>CHƯA</strong> hoàn tất đăng ký tài khoản:<br/>"
            + unregistered_lines
        ))
        parts.append(email_paragraph(
            "👉 Truy cập website và đăng ký bằng đúng MSSV & Email đã đăng ký với BTC. Nếu phát hiện "
            "sai sót thông tin, vui lòng liên hệ BTC qua email <strong>vnutour@suctremmt.com</strong> "
            "hoặc kênh <strong>#support</strong> trên Discord để được hỗ trợ điều chỉnh."
        ))
        next_num = 2

    parts.append(email_paragraph(f"<strong>{next_num}️⃣ Tham gia Máy chủ Discord chính thức</strong>"))
    parts.append(email_paragraph(
        "Discord là kênh chính thức công bố lịch thi đấu, thể lệ, phân chia kênh riêng cho từng đội "
        "và hỗ trợ kỹ thuật từ BTC."
    ))
    parts.append(email_cta_button(discord_invite_url, "THAM GIA MÁY CHỦ DISCORD"))
    next_num += 1

    parts.append(email_paragraph(f"<strong>{next_num}️⃣ Kết nối tài khoản Discord với Website</strong>"))
    parts.append(email_paragraph(
        "Sau khi hoàn tất tạo tài khoản trên website, các thành viên vui lòng thực hiện "
        "<strong>kết nối tài khoản Discord với Website</strong> theo các bước hướng dẫn hiển thị "
        "chi tiết trên hệ thống."
    ))

    parts.append(email_paragraph(
        "📌 <strong>MỘT SỐ LƯU Ý KHÁC:</strong><br/>"
        "• Đội chưa đủ 5 thành viên: BTC đang tiến hành ghép đội và sẽ thông báo kết quả bổ sung "
        "trong thời gian sớm nhất.<br/>"
        "• Theo dõi thông tin: Thường xuyên kiểm tra Email (cả hộp thư Spam/Quảng cáo) và kênh "
        "Discord để cập nhật lịch trình Vòng loại mới nhất.<br/>"
        "• Hỗ trợ: Mọi thắc mắc, bạn có thể trao đổi qua kênh #support trên Discord hoặc email hỗ "
        "trợ của BTC."
    ))

    parts.append(email_paragraph(
        f"Hẹn gặp lại đội <strong>{team_esc}</strong> tại đường đua <strong>VNU Tour 2026</strong> — "
        "hãy sẵn sàng bùng nổ và cháy hết mình nhé!"
    ))
    parts.append(email_paragraph("Trân trọng,<br/><strong>BTC VNU Tour 2026</strong>"))

    return "".join(parts)


def send_team_approved_email(team: Team | None, *, created_by: Account | None = None) -> None:
    """Email 2, fired from `team_service.approve_team` after approval succeeds.

    To=captain, CC=other members. Never raises — enqueue failures are logged.
    """
    try:
        if not team:
            return
        memberships = list(
            TeamMembership.objects.filter(team=team)
            .select_related("participant")
            .order_by("-is_captain", "id")
        )
        if not memberships:
            return
        captain_membership = next((m for m in memberships if m.is_captain), memberships[0])
        captain = captain_membership.participant
        if not captain.email:
            return

        cc_emails = [
            m.participant.email for m in memberships
            if m.participant_id != captain.id and m.participant.email
        ]
        unregistered = [
            (m.participant.full_name or "", m.participant.mssv or "", m.participant.email or "")
            for m in memberships if not _has_account(m.participant)
        ]

        body = _team_approved_body(
            ten=captain.full_name or "",
            team_name=team.name or "",
            unregistered=unregistered,
            discord_invite_url=getattr(settings, "DISCORD_INVITE_URL", "") or "",
        )
        html_body = render_branded_email(title="THÔNG BÁO DUYỆT HỒ SƠ", body_html=body)
        subject = f"[VNU Tour 2026] Thông báo duyệt hồ sơ — Chúc mừng đội {team.name}!"

        enqueue_email_messages(
            messages=[{
                "to_emails": [captain.email],
                "cc_emails": cc_emails,
                "subject": subject,
                "html_body": html_body,
            }],
            created_by=created_by,
        )
    except Exception:
        logger.exception(
            "Failed to enqueue team-approved email for team %s", getattr(team, "code", None),
        )
