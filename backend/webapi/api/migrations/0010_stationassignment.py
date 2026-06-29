from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0009_update_registration_schema_v2"),
    ]

    operations = [
        migrations.CreateModel(
            name="StationAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("shift_start", models.DateTimeField(blank=True, null=True)),
                ("shift_end", models.DateTimeField(blank=True, null=True)),
                ("note", models.TextField(blank=True, null=True)),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("collab", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="station_assignments", to="api.account")),
                ("station", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="assignments", to="api.station")),
            ],
            options={
                "db_table": "station_assignment",
                "ordering": ["station__sub_event", "station__order", "collab__username"],
            },
        ),
    ]
