from __future__ import annotations

from collections.abc import Iterable

from django.conf import settings
from django.core.mail import EmailMultiAlternatives


def send_email(*, to_emails: list[str], subject: str, html_body: str) -> int:
    """Send an HTML email to the given list of recipients."""
    if not to_emails:
        return 0

    msg = EmailMultiAlternatives(
        subject=subject,
        body="Vui long xem email nay duoi dang HTML.",
        from_email=settings.EMAIL_FROM,
        to=to_emails,
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
