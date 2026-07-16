from django.db import migrations, models
from django.db.models import Count, Q


def clean_duplicate_rows(apps, schema_editor):
    ProgramPhase = apps.get_model("api", "ProgramPhase")
    TeamMembership = apps.get_model("api", "TeamMembership")
    ScoreEntry = apps.get_model("api", "ScoreEntry")

    current_phases = ProgramPhase.objects.filter(is_current=True).order_by("order", "id")
    keep_current = current_phases.first()
    if keep_current:
        current_phases.exclude(id=keep_current.id).update(is_current=False)

    captain_groups = (
        TeamMembership.objects.filter(is_captain=True)
        .values("team_id")
        .annotate(row_count=Count("id"))
        .filter(row_count__gt=1)
    )
    for group in captain_groups:
        captains = TeamMembership.objects.filter(
            team_id=group["team_id"],
            is_captain=True,
        ).order_by("created_at", "id")
        keep = captains.first()
        captains.exclude(id=keep.id).update(is_captain=False)

    session_groups = (
        ScoreEntry.objects.filter(
            station_session_id__isnull=False,
            kind="station",
        )
        .values("station_session_id")
        .annotate(row_count=Count("id"))
        .filter(row_count__gt=1)
    )
    for group in session_groups:
        entries = ScoreEntry.objects.filter(
            station_session_id=group["station_session_id"],
            kind="station",
        ).order_by("-updated_at", "-id")
        keep = entries.first()
        entries.exclude(id=keep.id).delete()

    submission_groups = (
        ScoreEntry.objects.filter(
            submission_id__isnull=False,
            kind="station",
        )
        .values("submission_id")
        .annotate(row_count=Count("id"))
        .filter(row_count__gt=1)
    )
    for group in submission_groups:
        entries = ScoreEntry.objects.filter(
            submission_id=group["submission_id"],
            kind="station",
        ).order_by("-updated_at", "-id")
        keep = entries.first()
        entries.exclude(id=keep.id).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0015_account_token_created_at"),
    ]

    operations = [
        migrations.RunPython(clean_duplicate_rows, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="teammembership",
            constraint=models.UniqueConstraint(
                fields=("team",),
                condition=Q(is_captain=True),
                name="uq_membership_one_captain_per_team",
            ),
        ),
        migrations.AddConstraint(
            model_name="programphase",
            constraint=models.UniqueConstraint(
                fields=("is_current",),
                condition=Q(is_current=True),
                name="uq_program_phase_single_current",
            ),
        ),
        migrations.AddConstraint(
            model_name="scoreentry",
            constraint=models.UniqueConstraint(
                fields=("station_session", "kind"),
                condition=Q(station_session__isnull=False, kind="station"),
                name="uq_station_score_per_session",
            ),
        ),
        migrations.AddConstraint(
            model_name="scoreentry",
            constraint=models.UniqueConstraint(
                fields=("submission", "kind"),
                condition=Q(submission__isnull=False, kind="station"),
                name="uq_station_score_per_submission",
            ),
        ),
    ]
