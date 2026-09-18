"""Give every event that already requires check-in its check-in station.

New and edited events get one from `program_service.ensure_checkin_station`;
this covers the events configured before that rule existed.
"""
from django.db import migrations


def backfill(apps, schema_editor):
    SubEvent = apps.get_model("api", "SubEvent")
    Station = apps.get_model("api", "Station")
    for se in SubEvent.objects.filter(require_checkin=True):
        if Station.objects.filter(sub_event=se, kind="checkin").exists():
            continue
        taken = set(Station.objects.filter(sub_event=se).values_list("code", flat=True))
        code, n = "CHECKIN", 2
        while code in taken:
            code, n = f"CHECKIN-{n}", n + 1
        Station.objects.create(
            sub_event=se, kind="checkin", code=code, name="Trạm điểm danh", order=-1,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0055_individual_event_attendance"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
