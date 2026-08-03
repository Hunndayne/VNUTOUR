"""Promote the seeded `hunn` account to master admin.

Migration 0002 seeded `hunn` as the first admin. Splitting the role means
somebody has to hold the master role from the start, or nobody can change the
current phase, the phase calendar, sub-events or stations — and nobody can
grant the role either, since only a master admin may hand it out.

Reverse drops `hunn` back to plain admin.
"""

from django.db import migrations


SEED_USERNAME = "hunn"


def promote(apps, schema_editor):
    Account = apps.get_model("api", "Account")
    Account.objects.filter(username__iexact=SEED_USERNAME).update(role="master_admin")


def demote(apps, schema_editor):
    Account = apps.get_model("api", "Account")
    Account.objects.filter(username__iexact=SEED_USERNAME).update(role="admin")


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0020_alter_account_role"),
    ]

    operations = [
        migrations.RunPython(promote, demote),
    ]
