import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0054_station_kind_checkout_replay_after_pass")]

    operations = [
        migrations.AddField(
            model_name="subevent",
            name="checkin_mode",
            field=models.CharField(
                choices=[("team", "Team"), ("individual", "Individual")],
                default="team",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="subevent",
            name="min_checkin_members",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddConstraint(
            model_name="subevent",
            constraint=models.CheckConstraint(
                condition=models.Q(("min_checkin_members__gte", 1)),
                name="subevent_min_checkin_members_positive",
            ),
        ),
        migrations.CreateModel(
            name="EventAttendance",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("checkin", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="attendances", to="api.eventcheckin")),
                ("participant", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="event_attendances", to="api.participant")),
                ("scanner", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="scanned_attendances", to="api.account")),
            ],
            options={"db_table": "event_attendance"},
        ),
        migrations.AddConstraint(
            model_name="eventattendance",
            constraint=models.UniqueConstraint(
                fields=("checkin", "participant"), name="uq_checkin_participant",
            ),
        ),
    ]
