Docker Deployment
=================

This repo includes a containerized setup to run the Discord bot on Ubuntu (or any Docker host).

Files
-----
- `Dockerfile`: Builds the runtime image (Python 3.11 + ffmpeg + libopus).
- `.dockerignore`: Keeps secrets and dev files out of the build context.
- `docker-compose.yml`: Local orchestration with env file and a data volume.
- `.env.docker.example`: Copy to `.env.docker` and fill with your values.

Prerequisites (Ubuntu Server)
----------------------------
- Docker Engine + Compose plugin
  - Quick install: `curl -fsSL https://get.docker.com | sudo sh`
  - Optional: `sudo usermod -aG docker $USER && newgrp docker`

Configure
---------
1) Environment variables

- Copy `.env.docker.example` to `.env.docker` and fill with your real values:
  - `DISCORD_TOKEN`, `MongoDB`, `GoogleSheetID`, etc.
  - Ensure channel/role IDs are numeric (no quotes needed).
  - ffmpeg path is set via compose as `FFMPEG_EXE=ffmpeg`.

2) Google credentials

- Option A (secrets, recommended):
  - Save your service account file at `./credentials/service_account.json`.
  - Uncomment the `secrets:` block in `docker-compose.yml` and set
    `GOOGLE_CREDENTIALS_JSON=/run/secrets/google_credentials`.
- Option B (bind-mount):
  - Mount `./credentials:/app/credentials:ro` and set
    `GOOGLE_CREDENTIALS_JSON=/app/credentials/service_account.json` in `.env.docker`.
- Option C (base64 env):
  - Put the base64 of the JSON into `GOOGLE_CREDENTIALS_BASE64` in `.env.docker`.

3) Sheet snapshot caching (optional but useful)

- A small host directory `./data` is mounted to store `/data/sheet_snapshot.json`.
  This allows diff-based syncs across restarts.

Build & Run
-----------
- Build the image:

  ```bash
  docker compose build
  ```

- Start the bot in the background:

  ```bash
  docker compose up -d
  ```

- Tail logs:

  ```bash
  docker compose logs -f bot
  ```

- Update after code changes:

  ```bash
  docker compose up -d --build
  ```

Running on multiple machines
----------------------------
- Option 1: Push to a registry
  - Tag and push once:
    ```bash
    docker tag vnutour-bot:latest <your-username>/vnutour-bot:latest
    docker push <your-username>/vnutour-bot:latest
    ```
  - On other machines:
    ```bash
    docker pull <your-username>/vnutour-bot:latest
    docker compose up -d
    ```

- Option 2: Save and load image file
  - Export:
    ```bash
    docker save vnutour-bot:latest -o vnutour-bot.tar
    ```
  - Import on target host:
    ```bash
    docker load -i vnutour-bot.tar
    docker compose up -d
    ```

Notes
-----
- Do not bake real secrets into the image. Use env files, secrets, or mounts.
- No ports are exposed; the bot connects out to Discord/MongoDB.
- Voice/music features require `ffmpeg` and `libopus0` (both installed in the image).
- If you don’t use Google Sheets sync, you can omit credentials and `GoogleSheetAPI`.

