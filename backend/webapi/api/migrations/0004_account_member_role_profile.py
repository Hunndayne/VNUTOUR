from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0003_account_team_oid_captain_role"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="mssv",
            field=models.CharField(blank=True, max_length=20, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="account",
            name="full_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AlterField(
            model_name="account",
            name="role",
            field=models.CharField(
                choices=[
                    ("admin", "Admin"),
                    ("collab", "Collaborator"),
                    ("member", "Member"),
                ],
                default="collab",
                max_length=10,
            ),
        ),
    ]
