"""Django/PostgreSQL bootstrap and async-safe calls for the Discord process."""
from __future__ import annotations

import asyncio
import os
import sys
from functools import partial
from pathlib import Path
from typing import Any, Callable, TypeVar


T = TypeVar("T")
_configured = False


def setup_django() -> None:
    global _configured
    if _configured:
        return

    backend_root = Path(__file__).resolve().parents[2]
    webapi_root = backend_root / "webapi"
    if str(webapi_root) not in sys.path:
        sys.path.insert(0, str(webapi_root))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "serverapi.settings")

    import django

    django.setup()
    _configured = True


def _database_call(function: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    from django.db import close_old_connections

    close_old_connections()
    try:
        return function(*args, **kwargs)
    finally:
        close_old_connections()


async def database_call(function: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Run synchronous Django ORM work without blocking Discord heartbeats."""
    return await asyncio.to_thread(partial(_database_call, function, *args, **kwargs))
