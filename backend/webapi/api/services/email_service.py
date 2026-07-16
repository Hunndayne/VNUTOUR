from __future__ import annotations

from collections.abc import Iterable
from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import connection, transaction
from django.utils import timezone

from api.models import Account, EmailQueueItem


def send_email(
    *,
    to_emails: list[str],
    subject: str,
    html_body: str,
    cc_emails: list[str] | None = None,
    bcc_emails: list[str] | None = None,
) -> int:
    """Send an HTML email to the given list of recipients."""
    if not (to_emails or cc_emails or bcc_emails):
        return 0

    msg = EmailMultiAlternatives(
        subject=subject,
        body="Vui long xem email nay duoi dang HTML.",
        from_email=settings.EMAIL_FROM,
        to=to_emails,
        cc=cc_emails or [],
        bcc=bcc_emails or [],
    )
    msg.attach_alternative(html_body, "text/html")
    return msg.send(fail_silently=False)


def send_personalized_emails(*, messages: Iterable[dict]) -> tuple[int, list[str]]:
    """Send one email per recipient with already-rendered content."""
    sent = 0
    recipients: list[str] = []

    for item in messages:
        to_email = str(item.get("to_email") or "").strip()
        subject = str(item.get("subject") or "").strip()
        html_body = str(item.get("html_body") or "").strip()
        if not to_email or not subject or not html_body:
            continue

        msg = EmailMultiAlternatives(
            subject=subject,
            body="Vui long xem email nay duoi dang HTML.",
            from_email=settings.EMAIL_FROM,
            to=[to_email],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send(fail_silently=False)
        sent += 1
        recipients.append(to_email)

    return sent, recipients


def enqueue_email_messages(
    *,
    messages: Iterable[dict],
    created_by: Account,
    interval_seconds: int | None = None,
) -> list[EmailQueueItem]:
    """Persist email jobs with spacing between personalized messages."""
    interval = max(
        0,
        int(
            interval_seconds
            if interval_seconds is not None
            else getattr(settings, "EMAIL_QUEUE_INTERVAL_SECONDS", 10)
        ),
    )
    max_attempts = max(1, int(getattr(settings, "EMAIL_QUEUE_MAX_ATTEMPTS", 5)))
    base_time = timezone.now()
    queue_items = []
    for index, item in enumerate(messages):
        queue_items.append(EmailQueueItem(
            created_by=created_by,
            to_emails=list(item.get("to_emails") or []),
            cc_emails=list(item.get("cc_emails") or []),
            bcc_emails=list(item.get("bcc_emails") or []),
            subject=str(item.get("subject") or "").strip(),
            html_body=str(item.get("html_body") or "").strip(),
            scheduled_at=base_time + timedelta(seconds=index * interval),
            max_attempts=max_attempts,
        ))
    return EmailQueueItem.objects.bulk_create(queue_items)


def _claim_next_email() -> EmailQueueItem | None:
    with transaction.atomic():
        queryset = EmailQueueItem.objects.filter(
            status=EmailQueueItem.STATUS_QUEUED,
            scheduled_at__lte=timezone.now(),
        ).order_by("scheduled_at", "id")
        if connection.features.has_select_for_update:
            queryset = queryset.select_for_update(
                skip_locked=connection.features.has_select_for_update_skip_locked,
            )
        item = queryset.first()
        if not item:
            return None
        item.status = EmailQueueItem.STATUS_SENDING
        item.attempts += 1
        item.last_error = None
        item.save(update_fields=["status", "attempts", "last_error", "updated_at"])
        return item


def process_email_queue(*, limit: int = 20) -> dict:
    """Send due queue items with retry/backoff and stale-job recovery."""
    stale_seconds = max(60, int(getattr(settings, "EMAIL_QUEUE_STALE_SECONDS", 600)))
    EmailQueueItem.objects.filter(
        status=EmailQueueItem.STATUS_SENDING,
        updated_at__lt=timezone.now() - timedelta(seconds=stale_seconds),
    ).update(
        status=EmailQueueItem.STATUS_QUEUED,
        scheduled_at=timezone.now(),
        last_error="recovered_stale_sending_job",
    )

    sent = 0
    failed = 0
    for _ in range(max(1, int(limit))):
        item = _claim_next_email()
        if not item:
            break
        try:
            send_email(
                to_emails=item.to_emails,
                cc_emails=item.cc_emails,
                bcc_emails=item.bcc_emails,
                subject=item.subject,
                html_body=item.html_body,
            )
        except Exception as exc:
            failed += 1
            item.last_error = str(exc)[:2000]
            if item.attempts >= item.max_attempts:
                item.status = EmailQueueItem.STATUS_FAILED
            else:
                item.status = EmailQueueItem.STATUS_QUEUED
                delay = min(3600, 60 * (2 ** max(0, item.attempts - 1)))
                item.scheduled_at = timezone.now() + timedelta(seconds=delay)
            item.save(update_fields=[
                "status", "scheduled_at", "last_error", "updated_at",
            ])
            continue

        sent += 1
        item.status = EmailQueueItem.STATUS_SENT
        item.sent_at = timezone.now()
        item.last_error = None
        item.save(update_fields=[
            "status", "sent_at", "last_error", "updated_at",
        ])

    return {"sent": sent, "failed": failed}
