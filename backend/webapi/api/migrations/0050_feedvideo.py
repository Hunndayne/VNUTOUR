from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("api", "0049_fix_schemeless_feed_image_urls")]

    operations = [
        migrations.CreateModel(
            name="FeedVideo",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("storage_key", models.CharField(max_length=500, unique=True)),
                ("original_filename", models.CharField(max_length=255)),
                ("content_type", models.CharField(max_length=50)),
                ("size", models.PositiveBigIntegerField()),
                ("upload_id", models.TextField(blank=True, default="")),
                ("parts", models.JSONField(default=dict)),
                ("state", models.CharField(default="uploading", max_length=12)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("post", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="videos", to="api.feedpost")),
                ("uploaded_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="api.account")),
            ],
            options={"db_table": "feed_video", "ordering": ["created_at", "id"]},
        ),
    ]
