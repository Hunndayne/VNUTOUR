from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0002_seed_default_admin"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="team_oid",
            field=models.CharField(blank=True, max_length=24, null=True),
        ),
        migrations.AlterField(
            model_name="account",
            name="role",
            field=models.CharField(
                choices=[
                    ("admin", "Admin"),
                    ("collab", "Collaborator"),
                    ("captain", "Captain"),
                ],
                default="collab",
                max_length=10,
            ),
        ),
    ]
