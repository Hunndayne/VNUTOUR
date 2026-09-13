from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0043_add_identity_constraints"),
    ]

    operations = [
        migrations.CreateModel(
            name="PendingDeprovision",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("discord_role_id", models.BigIntegerField(blank=True, null=True)),
                ("text_channel_id", models.BigIntegerField(blank=True, null=True)),
                ("voice_channel_id", models.BigIntegerField(blank=True, null=True)),
                ("team_code", models.CharField(max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "pending_deprovision",
            },
        ),
    ]
