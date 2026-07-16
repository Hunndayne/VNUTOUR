from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0014_scoreentry_submission_stationsubmission_score"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="token_created_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
