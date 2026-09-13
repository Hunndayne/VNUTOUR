from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0045_pendingdeprovision_retry_fields")]

    operations = [
        migrations.AlterField(
            model_name="discordbroadcast",
            name="target",
            field=models.CharField(
                choices=[
                    ("all", "All"),
                    ("approved", "Approved"),
                    ("pending", "Pending"),
                    ("team_ids", "Specific Teams"),
                    ("channels", "Discord Channels"),
                ],
                default="all",
                max_length=10,
            ),
        ),
    ]
