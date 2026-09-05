"""Automated transactional emails around registration and team approval.

Email 1 ("registration received") fires from `register_individual` /
`register_team`; Email 2 ("team approved") fires from `team_service.approve_team`.
Both go through the same `EmailQueueItem` queue as every other transactional
email in this codebase (see test_password_reset.py, test_email_queue_api.py),
so asserting on the queued row is enough — no SMTP mocking needed.
"""

from unittest.mock import patch

from django.test import TestCase

from api.models import Account, EmailQueueItem, Team
from api.services.registration_service import register_individual, register_team
from api.services.team_service import approve_team

SUBJECT_REGISTRATION_RECEIVED = "[VNU Tour 2026] Xác nhận tiếp nhận thông tin đăng ký"


def person(mssv: str, **overrides) -> dict:
    data = {
        "full_name": f"Nguyen Van {mssv}",
        "gender": "male",
        "school": "UIT",
        "faculty": "KHMT",
        "mssv": mssv,
        "email": f"{mssv.lower()}@example.com",
        "phone": "0900000000",
        "cccd": "UIT",
        "date_of_birth": "2005-01-01",
        "facebook": "https://facebook.com/example",
    }
    data.update(overrides)
    return data


class RegistrationReceivedEmailTests(TestCase):
    def test_individual_registration_enqueues_confirmation_to_registrant(self):
        participant, error = register_individual(person("SV900"))

        self.assertIsNone(error)
        item = EmailQueueItem.objects.order_by("-id").first()
        self.assertIsNotNone(item, "a confirmation email should have been queued")
        self.assertEqual(item.to_emails, [participant.email])
        self.assertEqual(item.cc_emails, [])
        self.assertEqual(item.subject, SUBJECT_REGISTRATION_RECEIVED)
        self.assertIn("XÁC NHẬN TIẾP NHẬN ĐĂNG KÝ", item.html_body)
        self.assertIn("Nguyen Van SV900", item.html_body)
        self.assertIn("SV900", item.html_body)

    def test_team_registration_enqueues_confirmation_to_captain_with_members_cced(self):
        team, error = register_team({
            "team_name": "Doi Test",
            "captain": person("SV901"),
            "members": [person("SV902"), person("SV903"), person("SV904"), person("SV905")],
        })

        self.assertIsNone(error)
        self.assertIsNotNone(team)
        item = EmailQueueItem.objects.order_by("-id").first()
        self.assertIsNotNone(item)
        self.assertEqual(item.to_emails, ["sv901@example.com"])
        self.assertEqual(
            sorted(item.cc_emails),
            sorted([
                "sv902@example.com", "sv903@example.com",
                "sv904@example.com", "sv905@example.com",
            ]),
        )
        self.assertEqual(item.subject, SUBJECT_REGISTRATION_RECEIVED)
        for mssv in ("SV901", "SV902", "SV903", "SV904", "SV905"):
            self.assertIn(mssv, item.html_body)

    def test_individual_enqueue_failure_does_not_break_registration(self):
        with patch(
            "api.services.registration_emails.enqueue_email_messages",
            side_effect=RuntimeError("smtp down"),
        ):
            participant, error = register_individual(person("SV906"))

        self.assertIsNone(error)
        self.assertIsNotNone(participant)
        self.assertEqual(EmailQueueItem.objects.count(), 0)

    def test_team_enqueue_failure_does_not_break_registration(self):
        with patch(
            "api.services.registration_emails.enqueue_email_messages",
            side_effect=RuntimeError("smtp down"),
        ):
            team, error = register_team({
                "team_name": "Doi Loi",
                "captain": person("SV907"),
                "members": [person("SV908"), person("SV909"), person("SV909A"), person("SV909B")],
            })

        self.assertIsNone(error)
        self.assertIsNotNone(team)
        self.assertEqual(EmailQueueItem.objects.count(), 0)


class TeamApprovedEmailTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin", email="admin@example.com", password_hash="x",
            role=Account.ROLE_ADMIN,
        )

    def _team_with_members(self, mssvs, team_name="Doi Duyet"):
        team, error = register_team({
            "team_name": team_name,
            "captain": person(mssvs[0]),
            "members": [person(m) for m in mssvs[1:]],
        })
        self.assertIsNone(error)
        # Drop the registration-received email queued by register_team so each
        # test only sees the approval email it triggers.
        EmailQueueItem.objects.all().delete()
        return team

    def test_approval_email_lists_members_without_accounts(self):
        team = self._team_with_members(["SV910", "SV911", "SV912", "SV913", "SV914"])
        # Only the captain has a website account.
        Account.objects.create(
            username="sv910", email="sv910@example.com", password_hash="x",
            role=Account.ROLE_PARTICIPANT, mssv="SV910",
        )

        approve_team(team, self.admin)

        item = EmailQueueItem.objects.order_by("-id").first()
        self.assertIsNotNone(item)
        self.assertEqual(item.to_emails, ["sv910@example.com"])
        self.assertIn(
            f"[VNU Tour 2026] Thông báo duyệt hồ sơ — Chúc mừng đội {team.name}!",
            item.subject,
        )
        self.assertIn("hoàn thành <strong>3</strong> nhiệm vụ", item.html_body)
        self.assertIn("Hoàn tất tạo tài khoản trên Website chương trình", item.html_body)
        self.assertIn("CHƯA", item.html_body)
        self.assertIn("THAM GIA MÁY CHỦ DISCORD", item.html_body)
        for mssv in ("SV911", "SV912", "SV913", "SV914"):
            self.assertIn(f"MSSV: {mssv} —", item.html_body)
        # The captain already has an account and must not show up as missing.
        self.assertNotIn("MSSV: SV910 —", item.html_body)

    def test_approval_email_omits_account_task_when_everyone_registered(self):
        mssvs = ["SV920", "SV921", "SV922", "SV923", "SV924"]
        team = self._team_with_members(mssvs)
        for mssv in mssvs:
            Account.objects.create(
                username=mssv.lower(), email=f"{mssv.lower()}@example.com",
                password_hash="x", role=Account.ROLE_PARTICIPANT, mssv=mssv,
            )

        approve_team(team, self.admin)

        item = EmailQueueItem.objects.order_by("-id").first()
        self.assertIsNotNone(item)
        self.assertIn("hoàn thành <strong>2</strong> nhiệm vụ", item.html_body)
        self.assertNotIn("CHƯA", item.html_body)
        self.assertNotIn("Hoàn tất tạo tài khoản trên Website chương trình", item.html_body)
        self.assertIn("THAM GIA MÁY CHỦ DISCORD", item.html_body)

    def test_enqueue_failure_does_not_break_approval(self):
        team = self._team_with_members(["SV930", "SV931", "SV932", "SV933", "SV934"])

        with patch(
            "api.services.registration_emails.enqueue_email_messages",
            side_effect=RuntimeError("smtp down"),
        ):
            result = approve_team(team, self.admin)

        self.assertEqual(result.approval_status, Team.APPROVAL_APPROVED)
        self.assertEqual(EmailQueueItem.objects.count(), 0)
