import json
from io import StringIO

from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from api.models import Account, Participant


class AccountIdentityAuditTests(TestCase):
    def test_reports_mismatches_and_valid_unlinked_members_using_only_selects(self):
        account = Account.objects.create(username="audit", email="a@example.test", mssv="NEW1")
        Participant.objects.create(account=account, mssv="OLD1", full_name="Linked", email=account.email)
        Participant.objects.create(mssv="NEW1", full_name="Unlinked candidate")
        Participant.objects.create(mssv="NORMAL1", full_name="No account")
        out = StringIO()
        with CaptureQueriesContext(connection) as queries:
            call_command("audit_account_identity", stdout=out)
        result = json.loads(out.getvalue())
        self.assertEqual(result["linked_mssv_mismatch"], 1)
        self.assertEqual(result["unlinked_participants_valid_state"], 2)
        self.assertEqual(result["unlinked_with_matching_account_needs_review"], 1)
        self.assertEqual(result["linked_email_mismatch"], 0)
        self.assertTrue(all(q["sql"].lstrip().upper().startswith("SELECT") for q in queries))
        self.assertNotIn(account.email, out.getvalue())
