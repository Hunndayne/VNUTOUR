"""Gunicorn settings for the API container.

Only Prometheus needs anything here. Counters normally live in the worker
process that incremented them, so with --workers=3 a scrape lands on one
worker at random and reports roughly a third of the traffic, jumping between
samples as the load balancer picks a different worker. prometheus_client's
multiprocess mode fixes that by having every worker write into a shared
directory that the /metrics view sums on read, which in turn needs the
directory emptied at boot and each worker's files dropped when it dies.

Everything else stays in GUNICORN_CMD_ARGS in the Dockerfile.
"""

import os
import shutil

from prometheus_client import multiprocess

_MULTIPROC_DIR = os.environ.get("PROMETHEUS_MULTIPROC_DIR")

# Gunicorn already falls back to WEB_CONCURRENCY for this, but reading it here
# makes the worker count explicit rather than resting on that default. Two fits
# a 2 vCPU node; each worker costs roughly 200 MB, which is the figure that
# matters on a 4 GB machine.
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))


def on_starting(server):
    """Drop metric files left behind by the previous container.

    A restarted pod reuses the same path. Stale files are read as if they came
    from live workers, so old counters would be added to the fresh ones and the
    first scrape after a restart would show a jump that never happened.
    """
    if not _MULTIPROC_DIR:
        return
    shutil.rmtree(_MULTIPROC_DIR, ignore_errors=True)
    os.makedirs(_MULTIPROC_DIR, exist_ok=True)


def child_exit(server, worker):
    """Retire a dead worker's gauges.

    Runs in the master, which is the only process that learns a worker is gone.
    Without it the dead worker's samples keep being summed forever and metrics
    such as in-flight requests drift upward with every worker recycle.
    """
    if not _MULTIPROC_DIR:
        return
    multiprocess.mark_process_dead(worker.pid)
