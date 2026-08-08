Kubernetes Deployment
=====================

The same stack as `backend/DOCKER.md` — PostgreSQL, a one-shot migration job,
Gunicorn, the React/Nginx frontend, the Discord bot and the email worker — plus
a Prometheus/Grafana namespace. Written for a three-node k3s cluster (one
server, two agents).

Files are numbered in apply order. `00`–`10` are the application; `11`–`15` are
monitoring and can be applied, skipped or removed independently.

Cluster layout
--------------

| Node | vCPU | RAM | Role | Powered |
|---|---|---|---|---|
| `vnutour-cp` | 2 | 3 GB | k3s server, ingress-nginx, cert-manager | always |
| `vnutour-w1` | 2 | 4 GB | postgres, backend, and their volumes | always |
| `vnutour-w2` | 2 | 6 GB | frontend, bot, worker, spare capacity | daytime only |

`w2` is headroom, not required capacity: `w1` alone runs the whole application,
which is what makes it safe to power `w2` off overnight to free memory on the
Proxmox host. All application requests together come to 690m / 1344Mi, against
roughly 1500m / 3196Mi usable on `w1` after the k3s agent and the OS.

Resource limits are sized for these nodes. Their sum exceeds a single node's
memory on purpose — limits are ceilings that stop one runaway pod, not
reservations — but it does mean the numbers cannot simply be scaled up without
checking the total against the node again.

`w1` must carry the label the stateful pods select on, or postgres and the
backend stay Pending:

```bash
kubectl label node vnutour-w1 vnutour/storage=true
```

Cluster prerequisites
---------------------

**Ingress controller.** `10.ingress.yaml` sets `ingressClassName: nginx`, and a
stock k3s ships Traefik instead — it will accept the object and never route to
it. Install the server with Traefik disabled:

```bash
curl -sfL https://get.k3s.io | sh -s - server --disable=traefik
```

On a cluster that is already running, remove it instead:

```bash
kubectl -n kube-system delete helmchart traefik traefik-crd
```

Then install ingress-nginx:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx --namespace ingress-nginx --create-namespace
```

Leave `use-forwarded-headers` alone. This controller is the outermost hop, so
it should write `X-Forwarded-Proto` from the connection it actually accepted.
Turning the option on makes it trust the header the *client* sent instead,
which lets anyone claim their plaintext request arrived over HTTPS. It belongs
on only when a proxy you control sits in front.

`TRUST_PROXY_HEADERS=1` in the ConfigMap is still required, and is a separate
thing: it tells Django to believe the header ingress-nginx writes, since every
hop inside the cluster is plain HTTP.

**Exposure.** Traffic arrives on the router's forwarded ports rather than
through a tunnel, so the cluster is directly reachable. Forward **only 80 and
443** to the control plane's address. Port 6443 is the Kubernetes API and 22 is
SSH; neither belongs on the public internet.

Port 80 has to stay forwarded even though the site redirects everything to
HTTPS — that is the path ACME uses, both for the first certificate and for
every renewal after.

If the ISP hands out a dynamic address, set up dynamic DNS before going
further. A changed IP does not just take the site offline; it silently breaks
certificate renewal sixty days later, long after anyone connects the two.

**TLS.** cert-manager issues real certificates over HTTP-01:

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
```

Then apply the issuers and wait for the webhook to be ready before anything
requests a certificate:

```bash
kubectl -n cert-manager rollout status deploy/cert-manager-webhook
```

```bash
kubectl apply -f k8s/cert-manager-issuer.yaml
```

Point `10.ingress.yaml` at `letsencrypt-staging` for the first attempt. Let's
Encrypt rate-limits failures on the production endpoint hard, and a wrong DNS
record or a missing port forward burns that budget in minutes.

**Storage.** k3s provides `local-path` as the default StorageClass. These
volumes live on one node's disk, so any pod mounting one is pinned to that
node — see Known limitations.

A claim binds to whichever node its pod first lands on, which makes the very
first apply the moment that decides where the database lives for good. Do it
with `w2` powered off, so nothing can bind a volume to the node that gets shut
down every night. The `nodeSelector` on postgres and the backend is the second
guard on the same problem.

Secrets
-------

`02.secret.yaml` holds placeholders and is not meant to be applied as-is.
Create the real secret from a file kept outside the repository:

```bash
kubectl -n vnutour create secret generic backend-secret --from-env-file=/srv/vnutour/.env.docker
```

Key names must match `webapi/serverapi/settings.py` exactly. In particular the
Django secret is `DJANGO_SECRET_KEY`, and SMTP settings are read as `SMTP_*`
rather than Django's own `EMAIL_*` names.

Deploy
------

```bash
kubectl apply -f k8s/00.namespace.yaml
kubectl apply -f k8s/01.configmap.yaml -f k8s/03.storage.yaml
kubectl apply -f k8s/04.postgres.yaml
kubectl -n vnutour rollout status statefulset/postgres
```

The migration job cleans itself up an hour after it finishes, so routine
deploys can just apply it. Redeploying sooner than that hits the fact that a
Job's pod template is immutable and a second apply with a new image tag is
rejected, so delete it first.

```bash
kubectl -n vnutour delete job vnutour-migrate --ignore-not-found
kubectl apply -f k8s/05.migrate-job.yaml
kubectl -n vnutour wait --for=condition=complete job/vnutour-migrate --timeout=300s
```

Nothing else orders itself behind the migration, so wait for it before starting
the workloads. The backend gates itself through its readiness probe, but the
bot and the email worker have no probe and will happily run against an
unmigrated schema.

```bash
kubectl apply -f k8s/06.backend.yaml -f k8s/07.bot.yaml -f k8s/08.email-worker.yaml -f k8s/09.frontend.yaml -f k8s/10.ingress.yaml
```

Monitoring — optional, and currently deferred
---------------------------------------------

**This does not fit the cluster above yet.** The k3s server, the OS,
ingress-nginx and cert-manager's three pods already take roughly 1.9 GB of the
control plane's 3 GB, and Prometheus alone requests 512Mi and grows toward
2 GB. Apply `00`–`10` first and run without it; add monitoring once a node has
the memory, either by raising the control plane to 6 GB or by putting
Prometheus on `w2` during the day.

If memory is tight but some visibility is wanted, drop `15.grafana.yaml` and
query Prometheus directly through a port-forward, and cut retention in
`14.prometheus.yaml` from 15d to 7d.

```bash
kubectl apply -f k8s/11.monitoring-namespace.yaml -f k8s/12.kube-state-metrics.yaml -f k8s/13.node-exporter.yaml -f k8s/14.prometheus.yaml -f k8s/15.grafana.yaml
```

Prometheus discovers targets from the `prometheus.io/scrape` annotation rather
than from ServiceMonitor objects, because a plain k3s has no Prometheus
Operator to read them. Three pods carry that annotation: the backend exports
Django request metrics on `:8000/metrics`, the postgres pod runs an exporter
sidecar on `:9187`, and the frontend pod runs one on `:9113` reading Nginx's
`stub_status`.

Neither service is exposed through the Ingress. Reach them with a port-forward:

```bash
kubectl -n monitoring port-forward svc/grafana 3000:3000
```

Change the placeholder admin password in `15.grafana.yaml` first.

Powering `w2` down overnight
----------------------------

Frees memory on the Proxmox host for the RL cluster to run at night. Drain
first, then shut the VM down:

```bash
kubectl drain vnutour-w2 --ignore-daemonsets --delete-emptydir-data
```

```bash
kubectl uncordon vnutour-w2
```

Draining moves the pods to `w1` before the node goes away. Shutting the VM down
without it leaves the node NotReady for about five minutes before the
controller evicts anything, and the bot is offline for that whole window
without being rescheduled anywhere.

Never do this to `w1`. Its volumes are the database, the uploads and the
backups, and none of them follow the pod to another node — that is an outage,
not reduced capacity.

Known limitations
-----------------

**The backend cannot scale past one replica yet.** It mounts the `media-data`
and `backup-data` claims, and `local-path` volumes are node-local, so every
backend pod is pinned to the node holding them — the `nodeSelector` states
outright what the volumes were going to enforce anyway. An HPA would pile all
replicas onto that one node or leave them Pending. Making the backend
stateless — uploads to R2, which `settings.py` already supports, and database
dumps moved to their own CronJob — is a prerequisite for autoscaling it, and
deleting the `nodeSelector` is the last step of that change, not the first.
The frontend has no volumes and scales today.

For the same reason the backend deploys with `strategy: Recreate` and takes a
few seconds of downtime on each rollout. A rolling update would have to surge a
second pod onto the one node holding those volumes, and anywhere else it cannot
attach them — the rollout would stop with the new pod Pending. Both this and
the HPA question are fixed by the same change.

**The bot and the email worker must stay at one replica.** Two bot pods mean
two Discord gateway sessions on the same token and every slash command runs
twice. Both use `strategy: Recreate` so a rollout never overlaps them. Do not
put an HPA on either.
