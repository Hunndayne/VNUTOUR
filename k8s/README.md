Kubernetes Deployment
=====================

The same stack as `backend/DOCKER.md` — PostgreSQL, a one-shot migration job,
Gunicorn, the React/Nginx frontend, the Discord bot and the email worker — plus
a Prometheus/Grafana namespace and a nightly backup CronJob. This is what
production runs on: the Compose stack it replaced is gone, and so is the
Cloudflare Tunnel that used to front it.

Files are numbered in apply order. `00`–`10` are the application, `11`–`15` are
monitoring, `16` is the backup CronJob. `cert-manager-issuer.yaml` is a leftover
from the ACME attempt and is no longer applied — see **TLS** below.

Cluster layout
--------------

| Node | Address | vCPU | RAM | Runs |
|---|---|---|---|---|
| `vnutour-cp` | 192.168.1.110 | 2 | 3 GB | k3s server, ingress-nginx, Prometheus, the CI runner |
| `vnutour-w1` | 192.168.1.111 | 2 | 3 GB | postgres, backend, frontend, bot, email-worker, Grafana |
| `vnutour-w2` | — | 2 | 6 GB | not built yet; headroom, powered off overnight when it is |

Ubuntu 24.04, k3s v1.36.3. `w1` alone runs the whole application, which is what
makes `w2` optional — and what makes it safe to power `w2` off overnight to free
memory on the Proxmox host for the RL cluster.

`w1` must carry the label the stateful pods select on, or postgres, the backend
and the backup Job stay Pending forever:

```bash
kubectl label node vnutour-w1 vnutour/storage=true
```

The control plane briefly ran with `CriticalAddonsOnly=true:NoExecute` while it
was a 2 GB VM, to keep application pods off it. That taint is **gone** now that
cp has 3 GB and hosts Prometheus. Nothing in these manifests tolerates it, so
putting it back strands every pod that is scheduled to cp afterwards.

Resource limits are sized for these nodes. Their sum exceeds a single node's
memory on purpose — limits are ceilings that stop one runaway pod, not
reservations — but it does mean the numbers cannot simply be scaled up without
checking the total against the node again.

Cluster prerequisites
---------------------

**Ingress controller.** `10.ingress.yaml` sets `ingressClassName: nginx`, and a
stock k3s ships Traefik instead — it will accept the object and never route to
it. Install the server with Traefik disabled:

```bash
curl -sfL https://get.k3s.io | sh -s - server --disable=traefik --node-ip 192.168.1.110
```

On a cluster that is already running, remove it instead:

```bash
kubectl -n kube-system delete helmchart traefik traefik-crd
```

Then install ingress-nginx **with forwarded headers turned on**:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.config.use-forwarded-headers=true
```

That setting is the opposite of what this file said while the cluster was its
own edge, and the reason is Cloudflare. Cloudflare terminates the browser's TLS
and sends `X-Forwarded-Proto: https`; without `use-forwarded-headers` the
controller overwrites that header from the hop it accepted, Django concludes the
request was plaintext, and `SECURE_SSL_REDIRECT` answers every `/api` call with a
301 that loops.

The cost is that ingress-nginx now believes whatever `X-Forwarded-Proto` reaches
it, so anything that can talk to the origin's 443 directly can claim its
plaintext request arrived over HTTPS. What closes that is the Cloudflare
allowlist in `host-firewall.nft` below: if the only source that can reach 443 is
Cloudflare, the header can only come from Cloudflare. Authenticated Origin Pulls
would add a second check at the TLS layer and is not set up.

`TRUST_PROXY_HEADERS=1` in the ConfigMap is a separate switch: it tells Django to
believe the header ingress-nginx passes on, since every hop inside the cluster is
plain HTTP.

**Exposure.** The router cannot forward an individual port, so the control plane
sits in its DMZ instead: every port on 192.168.1.110 arrives from the internet —
SSH, the Kubernetes API on 6443, the kubelet on 10250, the whole NodePort range.
Nothing upstream filters any of it. That makes `host-firewall.nft` the only thing
between the cluster and the internet rather than a second layer, which is why it
is in this repository instead of living only on the host.

It is an nftables table of its own (`inet vnutour_fw`) at priority -10, not ufw:
k3s writes its rules through iptables-nft, ufw's `DEFAULT_FORWARD_POLICY=DROP`
breaks pod networking, and a ufw reload walks over kube-proxy's chains. A
separate table runs ahead of k3s' own and survives a k3s restart untouched.

It filters **both** `input` and `forward`. Traffic to 443 and to every NodePort
is DNAT'd in `PREROUTING` and then routed to a pod, so it passes through FORWARD
and never reaches INPUT — an INPUT-only ruleset leaves the whole NodePort range
open while looking like it closed it.

The policy: from the internet only 443, and only from Cloudflare's published
ranges, so the origin cannot be scanned or hit directly and no request can skip
the edge. Everything arriving on any other interface is trusted — `enp6s19`
(10.10.10.11, the Proxmox SDN management network) and k3s' own `cni0`,
`flannel.1` and `veth*`. Sources inside `192.168.1.0/24` stay open on eth0 too,
because w1 reaches the apiserver, the kubelet and flannel's VXLAN across it;
closing that dropped w1 out of the cluster.

`update-cloudflare-ips.sh` fills the `cloudflare_v4`/`cloudflare_v6` sets from
cloudflare.com and runs weekly from a timer, keeping the last good copy in
`/var/lib/vnutour-fw/cloudflare.nft` so a boot with no network does not leave the
sets empty. Two consequences worth remembering: turning the orange cloud **off**
for a hostname takes it offline immediately, since traffic then comes straight
from clients, and Grafana on `:30300` is reachable from the LAN and the SDN only.

**TLS.** SSL/TLS mode is **Full (strict)**: Cloudflare connects to the origin
over HTTPS and validates the certificate, which is a **Cloudflare Origin
Certificate** — not Let's Encrypt. It is valid for 15 years and renews never, so
there is no cert-manager, no ACME, and no port-80 solver path to keep open.

```bash
kubectl -n vnutour create secret tls vnutour-tls --cert=origin.pem --key=origin.key
```

`10.ingress.yaml` references that secret and keeps `ssl-redirect: "false"`.
Forcing the redirect at the origin as well loops, because the edge already did
it.

cert-manager was tried and dropped. `cert-manager-issuer.yaml` stays in the tree
only as a record of that attempt — applying it does nothing useful unless
cert-manager is reinstalled, and Full (strict) does not need it.

**Images.** Both images live in a **private** GHCR repository under the owner
name in lowercase: `ghcr.io/hunndayne/vnutour-backend` and `-frontend`. The
cluster needs a pull secret, wired to the namespace's default ServiceAccount so
every pod picks it up without naming it:

```bash
kubectl -n vnutour create secret docker-registry ghcr \
  --docker-server=ghcr.io --docker-username=<github-user> --docker-password=<PAT with read:packages>
kubectl -n vnutour patch serviceaccount default \
  -p '{"imagePullSecrets":[{"name":"ghcr"}]}'
```

Tags are the short commit SHA. The tags written into the manifests are only a
bootstrap value — the live tag comes from `kubectl set image`, which is what CD
does, so a manifest can read older than what is running without anything being
wrong. Avoid deploying `:latest`: it takes away both rollback and the ability to
tell which build is live.

**Storage.** k3s provides `local-path` as the default StorageClass. These
volumes live on one node's disk, so any pod mounting one is pinned to that node —
see Known limitations.

A claim binds to whichever node its pod first lands on, which makes the very
first apply the moment that decides where the database lives for good. Do it
with `w2` powered off, so nothing can bind a volume to the node that gets shut
down every night. The `nodeSelector` on postgres, the backend and the backup Job
is the second guard on the same problem.

Secrets
-------

Four, none of them in git:

| Secret | Namespace | Holds |
|---|---|---|
| `backend-secret` | `vnutour` | DB credentials, `DJANGO_SECRET_KEY`, SMTP, Discord, R2 |
| `vnutour-tls` | `vnutour` | Cloudflare Origin Certificate |
| `ghcr` | `vnutour` | GHCR pull credentials |
| `grafana-admin` | `monitoring` | Grafana admin login |

`02.secret.yaml` holds placeholders and is not meant to be applied as-is. Create
the real one from a file kept outside the repository:

```bash
kubectl -n vnutour create secret generic backend-secret --from-env-file=/srv/vnutour/.env
```

That file has to be **minimal** — only genuinely secret keys. Pods load the
ConfigMap first and the Secret second, so any key present in both wins from the
Secret; a stray `DJANGO_ALLOWED_HOSTS` or `WEB_BASE_URL` copied out of the old
Compose env quietly overrides the correct value in `01.configmap.yaml`.

Key names must match `webapi/serverapi/settings.py` exactly. In particular the
Django secret is `DJANGO_SECRET_KEY`, and SMTP settings are read as `SMTP_*`
rather than Django's own `EMAIL_*` names.

`backend-secret` currently carries the `R2_*` keys, which means the application
stores uploaded media in R2 rather than on the `media-data` volume. That is also
why the backup CronJob's optional `r2-backup` secret does not exist: the
credentials it would supply are already in the environment.

Deploy
------

Only needed to build the cluster from scratch or to rebuild it elsewhere;
day-to-day deployment is the pipeline below.

```bash
kubectl apply -f k8s/00.namespace.yaml
kubectl apply -f k8s/01.configmap.yaml -f k8s/03.storage.yaml
kubectl apply -f k8s/04.postgres.yaml
kubectl -n vnutour rollout status statefulset/postgres
```

The migration job cleans itself up an hour after it finishes, so routine deploys
can just apply it. Redeploying sooner than that hits the fact that a Job's pod
template is immutable and a second apply with a new image tag is rejected, so
delete it first.

```bash
kubectl -n vnutour delete job vnutour-migrate --ignore-not-found
kubectl apply -f k8s/05.migrate-job.yaml
kubectl -n vnutour wait --for=condition=complete job/vnutour-migrate --timeout=300s
```

The Job runs `migrate` and then `seed_phases`. Both are idempotent. Nothing else
orders itself behind it, so wait for it before starting the workloads: the
backend gates itself through its readiness probe, but the bot and the email
worker have no probe and will happily run against an unmigrated schema.

```bash
kubectl apply -f k8s/06.backend.yaml -f k8s/07.bot.yaml -f k8s/08.email-worker.yaml -f k8s/09.frontend.yaml -f k8s/10.ingress.yaml
kubectl apply -f k8s/16.backup-cronjob.yaml
```

On a database that was created rather than restored, two things bite:

- **The `hunn` account has no usable password.** Migration 0021 promotes it to
  `master_admin` and 0024 invalidates the seeded one, and `Account` is not
  `AUTH_USER_MODEL` so `createsuperuser` is no help. Set one by hand through
  `manage.py shell`, and log in with the **username**, not the email —
  `auth_service` looks up `username__iexact`.
- **Program phases** come from `seed_phases`, not from `migrate`. Without them
  the admin pages 404 on `/api/program/phases/registration`. The migration Job
  already runs it; a hand-run `migrate` alone does not.

Continuous deployment
---------------------

`.github/workflows/ci.yml` runs tests and lint on every pull request. On a push
to `main` it also builds both images and pushes them to GHCR tagged with the
short SHA and `latest`, using the built-in `GITHUB_TOKEN` — no PAT is stored.
`VITE_GOOGLE_CLIENT_ID` has to exist as a **repository variable**, because Vite
bakes it into the bundle at build time and a ConfigMap value would come too late.

`.github/workflows/deploy.yml` then runs on the **self-hosted runner** in the
homelab — the cluster's API is closed to the internet, so a cloud runner could
not reach it. It runs the migration Job pinned to the image being deployed,
`kubectl set image` on all four Deployments, and waits for the rollout of the
backend and the frontend only. The bot is deliberately not waited on: it has no
readiness probe and CrashLoops whenever `DISCORD_TOKEN` is unset, which would
fail every deploy for an unrelated reason.

Rolling back is `Run workflow` on Deploy with an earlier short SHA in
`image_tag`. Deploying by hand is the same `kubectl set image`.

One gap to know about: the deploy does **not** re-tag `16.backup-cronjob.yaml`,
so the nightly backup keeps running whatever image the manifest names until it is
bumped by hand. It only matters when `backup_service` itself changes.

Monitoring
----------

Running, on the cluster described above.

```bash
kubectl apply -f k8s/11.monitoring-namespace.yaml -f k8s/12.kube-state-metrics.yaml -f k8s/13.node-exporter.yaml -f k8s/14.prometheus.yaml -f k8s/15.grafana.yaml
```

Prometheus is pinned to cp with a `nodeSelector` so its memory growth stays off
`w1`, where postgres and the backend live, and it is trimmed to fit a 3 GB
control plane: 5d retention, a 5GB size cap, a 6Gi volume and a 768Mi memory
limit. Those numbers are a budget, not a preference — Prometheus OOMing on the
control plane takes the k3s server down with it, so raise them only along with
the VM's RAM. Grafana, kube-state-metrics and node-exporter carry no such
constraint.

Prometheus discovers targets from the `prometheus.io/scrape` annotation rather
than from ServiceMonitor objects, because a plain k3s has no Prometheus Operator
to read them. Three pods carry that annotation: the backend exports Django
request metrics on `:8000/metrics`, the postgres pod runs an exporter sidecar on
`:9187`, and the frontend pod runs one on `:9113` reading Nginx's `stub_status`.

Grafana is a NodePort on `30300`, reachable over the LAN and the VPN at
`http://192.168.1.111:30300`, and not from the internet because the router
forwards no NodePort. Prometheus has no external route at all:

```bash
kubectl -n monitoring port-forward svc/prometheus 9090:9090
```

`15.grafana.yaml` still ships the placeholder password `change-me`. Change it.

Backup
------

`16.backup-cronjob.yaml` runs at 03:00 Asia/Ho_Chi_Minh. It calls the
application's own `create_backup(prefix='cron')` rather than `pg_dump`, so the
archive is exactly the `.zip` the admin restore page accepts, keeps the newest 14
on the `backup-data` volume, and copies each one offsite to Cloudflare R2
(`vnutour` bucket, `db-backups/` prefix) through `scripts/upload_backup.py`.

The local copy is the fast restore path and guards against logical mistakes; the
R2 copy is what survives losing `w1`. Pruning applies only to the local copies —
put a lifecycle rule on the bucket for the R2 side.

Rehearse restores on a scratch database. `restore_backup()` wipes the target
before loading, so pointing it at production to "check the backup" is how the
backup destroys what it was protecting.

Powering `w2` down overnight
----------------------------

Once it exists. Drain first, then shut the VM down:

```bash
kubectl drain vnutour-w2 --ignore-daemonsets --delete-emptydir-data
```

```bash
kubectl uncordon vnutour-w2
```

Draining moves the pods to `w1` before the node goes away. Shutting the VM down
without it leaves the node NotReady for about five minutes before the controller
evicts anything, and the bot is offline for that whole window without being
rescheduled anywhere.

Never do this to `w1`. Its volumes are the database, the uploads and the backups,
and none of them follow the pod to another node — that is an outage, not reduced
capacity.

Known limitations
-----------------

**The backend cannot scale past one replica yet.** It mounts the `media-data`
and `backup-data` claims, and `local-path` volumes are node-local, so every
backend pod is pinned to the node holding them — the `nodeSelector` states
outright what the volumes were going to enforce anyway. An HPA would pile all
replicas onto that one node or leave them Pending. Media is already on R2, so
what remains is dropping the two mounts once the backup Job is the only writer of
`/app/backups`; deleting the `nodeSelector` is the last step of that change, not
the first. The frontend has no volumes and scales today.

For the same reason the backend deploys with `strategy: Recreate` and takes a few
seconds of downtime on each rollout. A rolling update would have to surge a
second pod onto the one node holding those volumes, and anywhere else it cannot
attach them — the rollout would stop with the new pod Pending. Both this and the
HPA question are fixed by the same change.

**The bot and the email worker must stay at one replica.** Two bot pods mean two
Discord gateway sessions on the same token and every slash command runs twice.
Both use `strategy: Recreate` so a rollout never overlaps them. Do not put an HPA
on either.

**Postgres is a StatefulSet over a static PVC**, not `volumeClaimTemplates`.
Scaling it to 2 gives two postgres processes writing the same data directory.

**The homelab is a single point of failure.** One site, one ISP link, no UPS: a
power cut or an outage during the event stops the event. The R2 copy of the
backup is what a rebuild elsewhere would start from.
