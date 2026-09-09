FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=UTF-8 \
    LANG=C.UTF-8 \
    PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus-multiproc \
    WEB_CONCURRENCY=2 \
    GUNICORN_CMD_ARGS="--config=/app/gunicorn.conf.py --bind=0.0.0.0:8000 --threads=2 --timeout=120 --access-logfile=- --error-logfile=-"

WORKDIR /app

# Worker count comes from WEB_CONCURRENCY rather than --workers so a deployment
# can retune it with one environment variable instead of rewriting the whole
# argument string. Two suits a 2 vCPU node; each worker costs roughly 200 MB.

# ffmpeg/libopus are also needed when this image is reused for the Discord bot.
# We intentionally track the distro's current ffmpeg/libopus0; pinning apt
# versions breaks the build on every base-image refresh (Debian drops old
# versions from the mirror) for no security gain here.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       libopus0 \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system app \
    && adduser --system --ingroup app app

# Keep dependency installation in its own layer for faster rebuilds.
COPY requirements.txt ./
# pip/setuptools/wheel are the build toolchain — we deliberately take the latest;
# application dependencies are pinned in requirements.txt.
#
# The final upgrade re-pins setuptools/msgpack to patched versions AFTER the
# requirements install: a transitive dependency drags setuptools back down to
# 70.3.0 (CVE-2025-47273) and pulls msgpack 1.1.2 (GHSA-6v7p-g79w-8964), both
# of which Trivy blocks. Forcing them last clears the image scan.
# hadolint ignore=DL3013
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --upgrade "setuptools>=78.1.1" "msgpack>=1.2.1"

COPY --chown=app:app . .

# Named volumes inherit these owners on first use, so runtime services can
# persist uploads, backups, and bot cache without running as root.
RUN mkdir -p /app/webapi/media /app/backups /tmp/prometheus-multiproc \
    && chown -R app:app /app/webapi/media /app/backups /tmp/prometheus-multiproc

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; request = urllib.request.Request('http://127.0.0.1:8000/api/health', headers={'Host': 'localhost', 'X-Forwarded-Proto': 'https'}); urllib.request.urlopen(request, timeout=3)" || exit 1

# Other services can reuse the image and override this command for the bot,
# migrations, or the email worker.
CMD ["gunicorn", "--chdir", "webapi", "serverapi.wsgi:application"]
