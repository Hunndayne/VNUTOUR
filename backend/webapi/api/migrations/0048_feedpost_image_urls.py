from django.db import migrations, models


def copy_cover_to_image_urls(apps, schema_editor):
    FeedPost = apps.get_model("api", "FeedPost")
    for post in FeedPost.objects.exclude(cover_image_url="").iterator():
        post.image_urls = [post.cover_image_url]
        post.save(update_fields=["image_urls"])


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0047_teaminvitelink"),
    ]

    operations = [
        migrations.AddField(
            model_name="feedpost",
            name="image_urls",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(copy_cover_to_image_urls, migrations.RunPython.noop),
    ]
