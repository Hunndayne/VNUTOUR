from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0025_alter_subevent_type_teamformdraft"),
    ]

    operations = [
        migrations.AddField(
            model_name="participant",
            name="discord_username",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
    ]
