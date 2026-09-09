"""Read-only summary. Unlinked participants are valid, not automatically broken."""
import json

from django.core.management.base import BaseCommand
from django.db.models import Exists, F, OuterRef, Q

from api.models import Account, Participant


class Command(BaseCommand):
    help = "Report account/profile identity counts without writing or exposing personal data."

    def handle(self, *args, **options):
        linked = Participant.objects.filter(account__isnull=False)
        unlinked = Participant.objects.filter(account__isnull=True)
        matching_account = Account.objects.filter(
            Q(mssv=OuterRef("mssv"))
            | (Q(email=OuterRef("email")) & ~Q(email="")),
        )
        counts = {
            "accounts": Account.objects.count(),
            "participants": Participant.objects.count(),
            "linked_participants": linked.count(),
            "linked_mssv_mismatch": linked.exclude(mssv=F("account__mssv")).count(),
            "linked_email_mismatch": linked.exclude(email=F("account__email")).count(),
            "unlinked_participants_valid_state": unlinked.count(),
            "unlinked_with_matching_account_needs_review": unlinked.annotate(
                has_candidate=Exists(matching_account),
            ).filter(has_candidate=True).count(),
            "accounts_without_linked_profile": Account.objects.filter(participant_profile__isnull=True).count(),
        }
        self.stdout.write(json.dumps(counts, indent=2))
