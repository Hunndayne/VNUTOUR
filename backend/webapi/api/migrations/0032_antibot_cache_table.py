"""Bảng cache dùng chung cho rate limit (settings.CACHES → DatabaseCache).

DDL mirror lại y hệt những gì `manage.py createcachetable` tạo, để deploy chỉ
cần chạy migrate như thường mà không thêm bước riêng.
"""

from django.db import migrations

CACHE_TABLE = "vnutour_cache"


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0031_photoframe_framedownloadlog"),
    ]

    operations = [
        migrations.RunSQL(
            sql=f"""
                CREATE TABLE IF NOT EXISTS "{CACHE_TABLE}" (
                    "cache_key" varchar(255) NOT NULL PRIMARY KEY,
                    "value" text NOT NULL,
                    "expires" timestamptz NOT NULL
                );
                CREATE INDEX IF NOT EXISTS "{CACHE_TABLE}_expires_idx"
                    ON "{CACHE_TABLE}" ("expires");
            """,
            reverse_sql=f"""
                DROP TABLE IF EXISTS "{CACHE_TABLE}";
            """,
        ),
    ]
