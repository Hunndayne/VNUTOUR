"""Invalidate the historical administrator password committed in migration 0002."""

from django.contrib.auth.hashers import check_password, make_password
from django.db import migrations


SEED_USERNAME = "hunn"
KNOWN_PASSWORD = "28112005"


def invalidate_known_password(apps, schema_editor):
    Account = apps.get_model("api", "Account")
    account = Account.objects.filter(username__iexact=SEED_USERNAME).first()
    if account and check_password(KNOWN_PASSWORD, account.password_hash):
        account.password_hash = make_password(None)
        account.save(update_fields=["password_hash"])


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0023_discordbroadcast_sending_status"),
    ]

    operations = [
        migrations.RunPython(invalidate_known_password, migrations.RunPython.noop),
    ]
