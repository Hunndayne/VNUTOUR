import json
from datetime import timedelta

from django.core import mail
from django.test import TestCase, override_settings

from api.models import Account, EmailQueueItem
from api.services.auth_service import generate_session
from api.services.email_service import process_email_queue


@override_settings(
    EMAIL_HOST="smtp.example.com",
    EMAIL_QUEUE_INTERVAL_SECONDS=10,
)
class EmailQueueApiTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="admin",
            email="admin@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
        )
        self.member_a = Account.objects.create(
            username="member-a",
            email="a@example.com",
            full_name="Member A",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
        )
        self.member_b = Account.objects.create(
            username="member-b",
            email="b@example.com",
            full_name="Member B",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
        )
        self.token = generate_session(self.admin)

    def _post(self, payload):
        return self.client.post(
            "/api/admin/send-email",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_standard_email_preserves_to_cc_and_bcc_in_queue(self):
        response = self._post({
            "recipient_type": "specific",
            "usernames": [self.member_a.username],
            "to_emails": ["outside@example.com"],
            "cc_emails": ["cc@example.com"],
            "bcc_emails": ["bcc@example.com"],
            "subject": "Thông báo",
            "html_body": "<p>Nội dung</p>",
        })

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["queued"], 1)
        item = EmailQueueItem.objects.get()
        self.assertEqual(item.to_emails, ["a@example.com", "outside@example.com"])
        self.assertEqual(item.cc_emails, ["cc@example.com"])
        self.assertEqual(item.bcc_emails, ["bcc@example.com"])

    def test_personalized_email_creates_spaced_queue_items(self):
        response = self._post({
            "recipient_type": "specific",
            "usernames": [self.member_a.username, self.member_b.username],
            "subject": "Chào {{ten}}",
            "html_body": "<p>{{email}}</p>",
        })

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["queued"], 2)
        items = list(EmailQueueItem.objects.order_by("scheduled_at"))
        self.assertEqual(items[0].to_emails, ["a@example.com"])
        self.assertEqual(items[0].subject, "Chào Member A")
        self.assertEqual(items[1].to_emails, ["b@example.com"])
        self.assertGreaterEqual(
            items[1].scheduled_at - items[0].scheduled_at,
            timedelta(seconds=10),
        )

    def test_worker_sends_queued_email_with_all_headers(self):
        EmailQueueItem.objects.create(
            created_by=self.admin,
            to_emails=["to@example.com"],
            cc_emails=["cc@example.com"],
            bcc_emails=["bcc@example.com"],
            subject="Queued",
            html_body="<p>Queued body</p>",
        )

        result = process_email_queue(limit=10)

        self.assertEqual(result["sent"], 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["to@example.com"])
        self.assertEqual(mail.outbox[0].cc, ["cc@example.com"])
        self.assertEqual(mail.outbox[0].bcc, ["bcc@example.com"])
        item = EmailQueueItem.objects.get()
        self.assertEqual(item.status, EmailQueueItem.STATUS_SENT)
