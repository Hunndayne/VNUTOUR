from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0033_shortlink"),
    ]

    operations = [
        migrations.AddField(
            model_name="team",
            name="roster_locked_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
    ]
