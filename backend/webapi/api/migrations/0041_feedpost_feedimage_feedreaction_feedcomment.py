# Generated manually for feed feature

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0040_passwordresettoken"),
    ]

    operations = [
        migrations.CreateModel(
            name="FeedPost",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("title", models.CharField(max_length=300)),
                ("body", models.TextField(help_text="Markdown content")),
                (
                    "cover_image_url",
                    models.CharField(blank=True, default="", max_length=500),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("draft", "Draft"), ("published", "Published")],
                        default="draft",
                        max_length=12,
                    ),
                ),
                ("is_pinned", models.BooleanField(default=False)),
                ("published_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "author",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="feed_posts",
                        to="api.account",
                    ),
                ),
            ],
            options={
                "db_table": "feed_post",
                "ordering": ["-is_pinned", "-published_at"],
            },
        ),
        migrations.CreateModel(
            name="FeedImage",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("image_url", models.CharField(max_length=500)),
                ("storage_type", models.CharField(default="local", max_length=10)),
                (
                    "storage_key",
                    models.CharField(blank=True, default="", max_length=500),
                ),
                (
                    "original_filename",
                    models.CharField(blank=True, default="", max_length=255),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "post",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="images",
                        to="api.feedpost",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to="api.account",
                    ),
                ),
            ],
            options={
                "db_table": "feed_image",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="FeedComment",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("body", models.TextField(max_length=1000)),
                ("is_deleted", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "author",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="feed_comments",
                        to="api.account",
                    ),
                ),
                (
                    "post",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="comments",
                        to="api.feedpost",
                    ),
                ),
            ],
            options={
                "db_table": "feed_comment",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="FeedReaction",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "reaction_type",
                    models.CharField(
                        choices=[
                            ("heart", "❤️"),
                            ("like", "👍"),
                            ("fire", "🔥"),
                            ("haha", "😂"),
                            ("wow", "😮"),
                        ],
                        max_length=10,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="feed_reactions",
                        to="api.account",
                    ),
                ),
                (
                    "post",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reactions",
                        to="api.feedpost",
                    ),
                ),
            ],
            options={
                "db_table": "feed_reaction",
                "constraints": [
                    models.UniqueConstraint(
                        fields=("post", "account"),
                        name="uq_feed_reaction_one_per_user",
                    )
                ],
            },
        ),
    ]
