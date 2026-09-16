from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0052_questionbankitem_explanation"),
    ]

    operations = [
        migrations.AddField(
            model_name="station",
            name="max_attempts",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddConstraint(
            model_name="station",
            constraint=models.CheckConstraint(
                condition=models.Q(max_attempts__isnull=True) | models.Q(max_attempts__gte=1),
                name="ck_station_max_attempts_positive",
            ),
        ),
    ]
