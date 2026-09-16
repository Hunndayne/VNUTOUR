from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0051_feedcomment_parent")]

    operations = [
        migrations.AddField(
            model_name="questionbankitem", name="explanation",
            field=models.TextField(blank=True, default=""),
        ),
    ]
