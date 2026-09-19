from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0056_backfill_checkin_stations"),
    ]

    operations = [
        migrations.AddField(
            model_name="stationsubmission",
            name="item_marks",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
