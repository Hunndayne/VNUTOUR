Docker Deployment
=================

The production stack contains PostgreSQL, a one-shot Django migration job,
Gunicorn, the React/Nginx frontend, the Discord bot, and the email worker.

Configure
---------

From `backend/`:

```bash
cp .env.docker.example .env.docker
```

Replace every placeholder secret and set the real hostname. Keep this file
outside the repository checkout on a deployed host — `/srv/vnutour/.env.docker`
with mode `600` — so a redeploy never overwrites it.

`docker-compose.prod.yml` overlays the base file with bounded log rotation and
a Cloudflare Tunnel. Select both files once per shell:

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

Deploy
------

```bash
docker compose --env-file .env.docker config
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

The `migrate` service must finish successfully before `backend` starts. Nginx
waits for the backend healthcheck before accepting traffic.

Useful commands
---------------

```bash
docker compose --env-file .env.docker logs -f backend frontend
docker compose --env-file .env.docker logs -f bot email-worker
docker compose --env-file .env.docker run --rm migrate
```

Persistent Docker volumes store PostgreSQL data, protected local uploads, and
backups. Do not remove these volumes during routine updates.

TLS
---

Nginx listens on HTTP inside the stack, and `cloudflared` opens an outbound
connection to Cloudflare's edge. A homelab therefore needs no port-forward, no
inbound firewall rule, and no static IP.

Create the tunnel in the Cloudflare Zero Trust dashboard, put its token in
`CLOUDFLARE_TUNNEL_TOKEN`, and route the public hostname to
`http://frontend:80`. Cloudflare terminates HTTPS and supplies
`X-Forwarded-Proto`, which `DJANGO_SECURE_SSL_REDIRECT=1` and
`TRUST_PROXY_HEADERS=1` rely on.

The frontend still binds `127.0.0.1:8080` on the host for local debugging. Do
not forward that port on the router.

CI/CD
-----

`.github/workflows/ci.yml` runs tests, lint, and the frontend build on
GitHub-hosted runners for every push and pull request.

`.github/workflows/deploy.yml` runs on a self-hosted runner installed on the
homelab, which connects outbound to GitHub and needs no inbound access. Install
it from the repository's Actions settings with the labels `self-hosted` and
`vnutour`, then run it as a service.

The deploy job builds first, backs up the database, applies migrations, and
starts the stack. Because the build precedes any change to the running
containers, a broken `Dockerfile` fails the deploy while the current stack keeps
serving.

Two settings the runner expects:

- `DEPLOY_ENV_FILE` — repository variable holding the absolute path to
  `.env.docker`. Defaults to `/srv/vnutour/.env.docker`.
- The runner's user must be in the `docker` group.

Never add a `pull_request` trigger to the deploy workflow. A self-hosted runner
executes whatever the workflow says, so a fork could otherwise run arbitrary
code on the home network.

Backups
-------

`scripts/backup_db.sh` writes a `pg_dump` custom-format archive to
`backend/backups` and prunes to `BACKUP_RETENTION` files. The deploy workflow
calls it before migrations; add a nightly cron entry as well:

```bash
0 3 * * * cd /srv/vnutour/repo/backend && BACKEND_ENV_FILE=/srv/vnutour/.env.docker bash ./scripts/backup_db.sh
```

Those dumps sit on the same disk as the database until they are copied off it.
Fill in the `R2_*` variables and `scripts/upload_backup.py` mirrors each dump to
Cloudflare R2; without them the deploy still succeeds and keeps the local copy
only.

Restore into a running stack:

```bash
docker compose --env-file .env.docker exec -T postgres \
  pg_restore --username "$DB_USER" --dbname "$DB_NAME" --clean --if-exists \
  < backups/vnutour-<timestamp>.dump
```

Rollback
--------

Every deploy tags its images with the commit SHA and images are kept for two
weeks. Roll back by running the deploy workflow manually with `image_tag` set to
a previous SHA, which skips the build and starts the older images.

Migrations do not roll back. Keep schema changes backward-compatible with the
previous release, or a rollback will start old code against a new schema.
