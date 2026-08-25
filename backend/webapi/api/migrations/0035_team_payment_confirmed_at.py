from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0034_team_roster_locked_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="team",
            name="payment_confirmed_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
    ]
