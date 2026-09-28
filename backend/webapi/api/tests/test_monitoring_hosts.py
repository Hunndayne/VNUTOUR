import runpy
from pathlib import Path

import pytest


SETTINGS = Path(__file__).resolve().parents[2] / "serverapi" / "settings.py"


def test_pod_ip_extends_only_explicit_allowed_hosts(monkeypatch):
    monkeypatch.setenv("DJANGO_ENV", "production")
    monkeypatch.setenv("DJANGO_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "vnutour.suctremmt.com,localhost")
    monkeypatch.setenv("DJANGO_POD_IP", "10.42.1.23")

    assert runpy.run_path(str(SETTINGS))["ALLOWED_HOSTS"] == [
        "vnutour.suctremmt.com", "localhost", "10.42.1.23",
    ]

    monkeypatch.setenv("DJANGO_POD_IP", "*")
    with pytest.raises(ValueError):
        runpy.run_path(str(SETTINGS))

    monkeypatch.setenv("DJANGO_POD_IP", "10.42.1.23")
    monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "")
    with pytest.raises(RuntimeError, match="DJANGO_ALLOWED_HOSTS"):
        runpy.run_path(str(SETTINGS))
