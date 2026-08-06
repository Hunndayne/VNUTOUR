"""Copy a database dump to Cloudflare R2.

Until this runs, every backup lives on the same homelab disk as the database it
came from. Runs inside the backend image, which already carries boto3:

    docker run --rm --env-file .env.docker \
      --volume "$PWD/backups:/backups:ro" \
      vnutour-backend:latest \
      python scripts/upload_backup.py /backups/vnutour-....dump
"""

import os
import sys
from pathlib import Path

import boto3


def resolve_endpoint():
    endpoint = os.getenv("R2_ENDPOINT_URL", "").strip()
    if endpoint:
        return endpoint
    account_id = os.getenv("R2_ACCOUNT_ID", "").strip()
    if account_id:
        return f"https://{account_id}.r2.cloudflarestorage.com"
    return ""


def main(argv):
    if len(argv) != 2:
        print("usage: upload_backup.py <dump-file>", file=sys.stderr)
        return 2

    path = Path(argv[1])
    if not path.is_file():
        print(f"no such file: {path}", file=sys.stderr)
        return 1

    endpoint = resolve_endpoint()
    bucket = os.getenv("R2_BUCKET", "").strip()
    access_key = os.getenv("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()

    # R2 is opt-in: the local dump is already a valid backup without it, so an
    # unconfigured stack should not fail its deploy here.
    if not (endpoint and bucket and access_key and secret_key):
        print("R2 is not configured; keeping the local dump only")
        return 0

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )
    prefix = os.getenv("BACKUP_PREFIX", "db-backups").strip("/")
    key = f"{prefix}/{path.name}" if prefix else path.name
    client.upload_file(str(path), bucket, key)
    print(f"uploaded {path.name} -> s3://{bucket}/{key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
