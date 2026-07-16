import time

from django.core.management.base import BaseCommand

from api.services.email_service import process_email_queue


class Command(BaseCommand):
    help = "Process queued email jobs with retry and pacing."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=20)
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--sleep", type=float, default=5.0)

    def handle(self, *args, **options):
        while True:
            result = process_email_queue(limit=options["limit"])
            if result["sent"] or result["failed"]:
                self.stdout.write(
                    f"sent={result['sent']} failed={result['failed']}",
                )
            if not options["watch"]:
                break
            time.sleep(max(1.0, options["sleep"]))
