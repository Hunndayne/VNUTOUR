import signal
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from photo_gallery.jobs import run_once, cleanup
from photo_gallery.storage import Storage
from photo_gallery.errors import GalleryError


class Command(BaseCommand):
    help = "Process Drive imports and event photos; safe to restart (DB leases)."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        stopping = False

        def stop(*_):
            nonlocal stopping
            stopping = True

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        last_cleanup = 0
        while not stopping:
            close_old_connections()
            worked = run_once(stop_requested=lambda: stopping)
            if not stopping and time.monotonic() - last_cleanup > 60:
                try:
                    cleanup(Storage())
                except GalleryError:
                    self.stderr.write("Photo storage cleanup deferred")
                last_cleanup = time.monotonic()
            if options["once"]:
                break
            if not worked:
                time.sleep(2)
