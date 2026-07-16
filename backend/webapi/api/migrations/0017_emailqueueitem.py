import django.utils.timezone
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0016_data_integrity_constraints"),
    ]

    operations = [
        migrations.CreateModel(
            name="EmailQueueItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("to_emails", models.JSONField(default=list)),
                ("cc_emails", models.JSONField(default=list)),
                ("bcc_emails", models.JSONField(default=list)),
                ("subject", models.CharField(max_length=998)),
                ("html_body", models.TextField()),
                ("status", models.CharField(
                    choices=[
                        ("queued", "Queued"),
                        ("sending", "Sending"),
                        ("sent", "Sent"),
                        ("failed", "Failed"),
                    ],
                    db_index=True,
                    default="queued",
                    max_length=10,
                )),
                ("scheduled_at", models.DateTimeField(
                    db_index=True,
                    default=django.utils.timezone.now,
                )),
                ("attempts", models.PositiveIntegerField(default=0)),
                ("max_attempts", models.PositiveIntegerField(default=5)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                ("last_error", models.TextField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="email_queue_items",
                    to="api.account",
                )),
            ],
            options={
                "db_table": "email_queue_item",
                "ordering": ["scheduled_at", "id"],
            },
        ),
    ]
