from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0011_stationassignment_uq_assignment_collab_station"),
    ]

    operations = [
        migrations.AddField(
            model_name="team",
            name="is_late_registration",
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name="stationsubmission",
            name="station_session",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="submissions",
                to="api.stationsession",
            ),
        ),
    ]
