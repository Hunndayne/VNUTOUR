from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0022_captainvote"),
    ]

    operations = [
        migrations.AlterField(
            model_name="discordbroadcast",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("sending", "Sending"),
                    ("sent", "Sent"),
                    ("failed", "Failed"),
                ],
                default="draft",
                max_length=10,
            ),
        ),
    ]
