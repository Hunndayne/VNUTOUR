from django.core.management.base import BaseCommand, CommandError

from api.services.feed_video_service import cleanup_abandoned_uploads


class Command(BaseCommand):
    help = "Delete unsaved videos idle for 24 hours, including R2 multipart uploads."

    def handle(self, *args, **options):
        removed, failed = cleanup_abandoned_uploads()
        self.stdout.write(f"Feed video cleanup: removed={removed}, failed={failed}")
        if failed:
            raise CommandError("Some R2 deletions failed; records retained for the next run.")
