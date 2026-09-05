# Split out of 0042 so the identity-normalization UPDATEs commit before these
# CREATE INDEX statements run. Adding the unique indexes in the same transaction
# as the preceding data migration made Postgres fail with "cannot CREATE INDEX
# ... because it has pending trigger events".

import django.db.models.functions.text
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0042_enforce_team_identity_integrity"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="account",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("email"),
                name="uq_account_email_ci",
            ),
        ),
        migrations.AddConstraint(
            model_name="account",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Upper("mssv"),
                condition=models.Q(
                    ("mssv__isnull", False), models.Q(("mssv", ""), _negated=True)
                ),
                name="uq_account_mssv_ci",
            ),
        ),
        migrations.AddConstraint(
            model_name="participant",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Upper("mssv"),
                name="uq_participant_mssv_ci",
            ),
        ),
        migrations.AddConstraint(
            model_name="participant",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("email"),
                condition=models.Q(
                    ("email__isnull", False), models.Q(("email", ""), _negated=True)
                ),
                name="uq_participant_email_ci",
            ),
        ),
        migrations.AddConstraint(
            model_name="team",
            constraint=models.UniqueConstraint(
                condition=models.Q(("owner_account__isnull", False)),
                fields=("owner_account",),
                name="uq_team_owner_account",
            ),
        ),
    ]
