from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0044_pendingdeprovision"),
    ]

    operations = [
        migrations.AddField(
            model_name="pendingdeprovision",
            name="attempts",
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name="pendingdeprovision",
            name="last_error",
            field=models.TextField(blank=True, default=""),
        ),
    ]
