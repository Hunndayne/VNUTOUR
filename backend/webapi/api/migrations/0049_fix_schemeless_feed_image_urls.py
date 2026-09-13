from django.db import migrations


BROKEN_PREFIX = "storage-vnutour.hiseku.net/"
ABSOLUTE_PREFIX = f"https://{BROKEN_PREFIX}"


def _fix_url(value):
    if not isinstance(value, str):
        return value
    if value.startswith(BROKEN_PREFIX):
        return f"https://{value}"
    if value.startswith(f"//{BROKEN_PREFIX}"):
        return f"https:{value}"
    return value


def fix_schemeless_feed_image_urls(apps, schema_editor):
    FeedImage = apps.get_model("api", "FeedImage")
    FeedPost = apps.get_model("api", "FeedPost")

    for image in FeedImage.objects.all().iterator():
        fixed_url = _fix_url(image.image_url)
        if fixed_url != image.image_url:
            image.image_url = fixed_url
            image.save(update_fields=["image_url"])

    for post in FeedPost.objects.all().iterator():
        update_fields = []

        fixed_cover = _fix_url(post.cover_image_url)
        if fixed_cover != post.cover_image_url:
            post.cover_image_url = fixed_cover
            update_fields.append("cover_image_url")

        fixed_gallery = [_fix_url(url) for url in (post.image_urls or [])]
        if fixed_gallery != (post.image_urls or []):
            post.image_urls = fixed_gallery
            update_fields.append("image_urls")

        fixed_body = (post.body or "").replace(
            f"]({BROKEN_PREFIX}",
            f"]({ABSOLUTE_PREFIX}",
        ).replace(
            f"](//{BROKEN_PREFIX}",
            f"]({ABSOLUTE_PREFIX}",
        )
        if fixed_body != post.body:
            post.body = fixed_body
            update_fields.append("body")

        if update_fields:
            post.save(update_fields=update_fields)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0048_feedpost_image_urls"),
    ]

    operations = [
        migrations.RunPython(
            fix_schemeless_feed_image_urls,
            migrations.RunPython.noop,
        ),
    ]
