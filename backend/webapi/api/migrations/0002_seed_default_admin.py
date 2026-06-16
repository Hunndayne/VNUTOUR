from django.db import migrations
from django.contrib.auth.hashers import make_password

def seed_admin(apps, schema_editor):
    Account = apps.get_model('api', 'Account')
    if not Account.objects.filter(username__iexact='hunn').exists():
        Account.objects.create(
            username='hunn',
            email='hungtt@suctremmt.com',
            password_hash=make_password('28112005'),
            role='admin',
            is_active=True,
        )

def unseed_admin(apps, schema_editor):
    Account = apps.get_model('api', 'Account')
    Account.objects.filter(username__iexact='hunn').delete()

class Migration(migrations.Migration):
    dependencies = [
        ('api', '0001_initial'),
    ]
    operations = [
        migrations.RunPython(seed_admin, unseed_admin),
    ]
