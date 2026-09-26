import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase


class RedisSettingsTests(SimpleTestCase):
    def test_kubernetes_service_link_does_not_override_redis_tcp_port(self):
        env = os.environ.copy()
        env.update({
            "DJANGO_SECRET_KEY": "test-secret-key",
            "REDIS_HOST": "redis",
            # Kubernetes injects this URI for a Service named "redis".
            "REDIS_PORT": "tcp://10.43.189.103:6379",
            "REDIS_TCP_PORT": "6380",
        })
        env.pop("REDIS_URL", None)

        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from serverapi import settings; print(settings.REDIS_PORT)",
            ],
            cwd=Path(__file__).resolve().parents[2],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "6380")
