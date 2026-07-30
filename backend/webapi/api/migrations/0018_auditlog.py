from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0017_emailqueueitem"),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("action", models.CharField(db_index=True, max_length=100)),
                ("target_type", models.CharField(blank=True, max_length=100, null=True)),
                ("target_id", models.CharField(blank=True, max_length=100, null=True)),
                ("summary", models.CharField(max_length=500)),
                ("before_data", models.JSONField(blank=True, null=True)),
                ("after_data", models.JSONField(blank=True, null=True)),
                ("metadata", models.JSONField(blank=True, null=True)),
                ("reversible", models.BooleanField(db_index=True, default=False)),
                ("undone_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("actor", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="audit_logs",
                    to="api.account",
                )),
                ("undo_audit", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="undoes",
                    to="api.auditlog",
                )),
                ("undone_by", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="undone_audit_logs",
                    to="api.account",
                )),
            ],
            options={
                "db_table": "audit_log",
                "ordering": ["-created_at", "-id"],
            },
        ),
    ]
