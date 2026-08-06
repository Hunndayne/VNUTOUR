Kubernetes Deployment
=====================

The same stack as `backend/DOCKER.md` — PostgreSQL, a one-shot migration job,
Gunicorn, the React/Nginx frontend, the Discord bot and the email worker — plus
a Prometheus/Grafana namespace. Written for a three-node k3s cluster (one
server, two agents).

Files are numbered in apply order. `00`–`10` are the application; `11`–`15` are
monitoring and can be applied, skipped or removed independently.

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
helm install ingress-nginx ingress-nginx/ingress-nginx --namespace ingress-nginx --create-namespace --set controller.config.use-forwarded-headers=true
```

`use-forwarded-headers` matters: without it the controller overwrites
`X-Forwarded-Proto` with the scheme it received, which is HTTP behind the
tunnel. Django would then see an insecure request and start redirecting to
HTTPS on every call, despite `TRUST_PROXY_HEADERS`.

**TLS.** The homelab has no inbound ports, so HTTPS arrives through a
Cloudflare Tunnel that terminates TLS at the edge and forwards plain HTTP to
the ingress controller. Route the public hostname to
`http://ingress-nginx-controller.ingress-nginx.svc` in the Zero Trust
dashboard. ACME HTTP-01 cannot complete on this network; if you want
certificates served by the cluster itself, use cert-manager with a DNS-01
solver and uncomment the `tls` block in `10.ingress.yaml`.

**Storage.** k3s provides `local-path` as the default StorageClass. These
volumes live on one node's disk, so any pod mounting one is pinned to that
node — see Known limitations.

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

Monitoring
----------

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

Known limitations
-----------------

**The backend cannot scale past one replica yet.** It mounts the `media-data`
and `backup-data` claims, and `local-path` volumes are node-local, so every
backend pod is pinned to whichever node holds them. An HPA would pile all
replicas onto that one node or leave them Pending. Making the backend
stateless — uploads to R2, which `settings.py` already supports, and database
dumps moved to their own CronJob — is a prerequisite for autoscaling it. The
frontend has no volumes and scales today.

For the same reason the backend deploys with `strategy: Recreate` and takes a
few seconds of downtime on each rollout. A rolling update would have to surge a
second pod onto the one node holding those volumes, and anywhere else it cannot
attach them — the rollout would stop with the new pod Pending. Both this and
the HPA question are fixed by the same change.

**The bot and the email worker must stay at one replica.** Two bot pods mean
two Discord gateway sessions on the same token and every slash command runs
twice. Both use `strategy: Recreate` so a rollout never overlaps them. Do not
put an HPA on either.
