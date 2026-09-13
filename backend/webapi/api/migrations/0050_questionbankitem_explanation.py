from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0049_fix_schemeless_feed_image_urls")]

    operations = [
        migrations.AddField(
            model_name="questionbankitem", name="explanation",
            field=models.TextField(blank=True, default=""),
        ),
    ]
