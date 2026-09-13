FROM python:3.11-slim-trixie

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
# Explicitly refresh the base/runtime packages flagged by the image scan.
# Installing ffmpeg alone can leave already-installed vulnerable versions in
# place, blocking backend deployment while the frontend has already rolled out.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       libopus0 \
       gzip \
       perl-base \
       libsqlite3-0 \
       libpcre2-8-0 \
       libmbedcrypto16 \
       libglib2.0-0t64 \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system app \
    && adduser --system --ingroup app app

# Keep dependency installation in its own layer for faster rebuilds.
COPY requirements.txt ./
# pip 26.2.1 vendors setuptools 70.3.0 and msgpack 1.1.2; upgrading the
# top-level packages does not patch pip/_vendor or its embedded SBOM.
# Keep setuptools patched, check dependencies, then remove build-only tools
# and ensurepip's bootstrap wheels so vulnerable copies do not ship at runtime.
# hadolint ignore=DL3013
RUN python -m pip install --no-cache-dir --upgrade pip "setuptools>=83.0.0" wheel \
    && python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip check \
    && python -m pip uninstall --yes pip wheel \
    && python -c "import pathlib, shutil, sysconfig; shutil.rmtree(pathlib.Path(sysconfig.get_path('stdlib')) / 'ensurepip')"

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
