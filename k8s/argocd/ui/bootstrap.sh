#!/usr/bin/env bash
# Run on VPS: sudo bash bootstrap.sh /path/to/payload
# The payload consists of files where hostname, email, and password hash have been populated by deploy.sh.
set +x
set -euo pipefail
umask 077
work=${1:?Pass the payload directory}
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 1. Check the existing k3s cluster before installing additional utilities.
if [[ $(id -u) != 0 ]]; then
  echo 'Run as root or with sudo -n.' >&2
  exit 1
fi
if ! command -v k3s > /dev/null; then
  echo 'k3s is missing; use the VPS containing the existing cluster.' >&2
  exit 1
fi
# Verify the version
test -r "$KUBECONFIG"
bash --version
k3s --version
k3s kubectl version

# 2. Keep existing tools; only install jq/curl if missing.
if ! command -v jq > /dev/null; then
  apt-get update -qq
  apt-get install -y --no-upgrade jq
fi
if ! command -v curl > /dev/null; then
  apt-get update -qq
  apt-get install -y --no-upgrade curl
fi
# Verify the version
jq --version
curl --version

# 3. Check required resources. Do not expose Secret contents to the terminal.
k3s kubectl get ingressclass nginx
k3s kubectl -n ingress-nginx get deployment ingress-nginx-controller
k3s kubectl -n argocd get deployment argocd-server
k3s kubectl -n argocd get service argocd-server
k3s kubectl -n argocd get configmap argocd-cm argocd-cmd-params-cm argocd-rbac-cm
k3s kubectl -n argocd get secret argocd-secret -o name

k3s kubectl get ingressclass nginx -o json |
  jq -e '.spec.controller == "k8s.io/ingress-nginx"' > /dev/null
k3s kubectl -n argocd get service argocd-server -o json |
  jq -e '.spec.type == "ClusterIP" and any(.spec.ports[]; .port == 443)' > /dev/null

# Hard-coded flags or environment variables can override the ConfigMap; stop before patching if they are present.
echo 'Checking ArgoCD flags and environment overrides...'
k3s kubectl -n argocd get deployment argocd-server -o json > "$work/deployment.json"
jq -e '[.spec.template.spec.containers[] | ((.command // []) + (.args // []))[] |
  select(test("^--(insecure|disable-auth|rootpath|basehref)(=|$)"))] | length == 0' \
  "$work/deployment.json" > /dev/null
jq -e '[.spec.template.spec.containers[].env[]? |
  select(.name == "ARGOCD_SERVER_INSECURE" or .name == "ARGOCD_SERVER_ROOTPATH" or .name == "ARGOCD_SERVER_BASEHREF") |
  select(.valueFrom.configMapKeyRef.name != "argocd-cmd-params-cm" or
    .valueFrom.configMapKeyRef.key != (if .name == "ARGOCD_SERVER_INSECURE" then "server.insecure"
      elif .name == "ARGOCD_SERVER_ROOTPATH" then "server.rootpath" else "server.basehref" end))] | length == 0' \
  "$work/deployment.json" > /dev/null

# 4. Only install cert-manager if neither the CRD nor the deployment exists.
crds=$(k3s kubectl get crd certificates.cert-manager.io issuers.cert-manager.io clusterissuers.cert-manager.io --ignore-not-found -o name)
if [[ -z $crds ]]; then
  deployments=$(k3s kubectl -n cert-manager get deployments --ignore-not-found -o name)
  if [[ -n $deployments ]]; then
    echo 'Partial cert-manager installation: deployments exist without CRDs.' >&2
    exit 1
  fi
  # Fixed release supports Kubernetes 1.33-1.36; do not auto-upgrade k3s.
  server_version=$(k3s kubectl version -o json | jq -r '.serverVersion.gitVersion')
  if [[ ! $server_version =~ ^v1\.(33|34|35|36)\. ]]; then
    echo 'cert-manager v1.21.2 requires Kubernetes 1.33-1.36.' >&2
    exit 1
  fi
  curl --fail --silent --show-error --location --max-time 120 \
    https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml \
    -o "$work/cert-manager.yaml"
  k3s kubectl apply -f "$work/cert-manager.yaml"
fi

# Check current installation, print image/version, and wait for controllers to be ready.
k3s kubectl get crd certificates.cert-manager.io issuers.cert-manager.io clusterissuers.cert-manager.io
k3s kubectl -n cert-manager get deployments -o wide
k3s kubectl -n cert-manager rollout status deployment/cert-manager --timeout=180s
k3s kubectl -n cert-manager rollout status deployment/cert-manager-cainjector --timeout=180s
k3s kubectl -n cert-manager rollout status deployment/cert-manager-webhook --timeout=180s

# 5. Validate manifests with API server before patching ArgoCD configuration.
k3s kubectl apply --dry-run=server -f "$work/cluster-issuers.yaml"
k3s kubectl -n argocd apply --dry-run=server -f "$work/certificate.yaml" -f "$work/ingress.yaml"

# 6. Use the same ClusterIssuer for ArgoCD and subsequent UIs.
k3s kubectl apply -f "$work/cluster-issuers.yaml"
k3s kubectl wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=120s

# 7. Merge only the keys that need to change; preserve RBAC, SSO, and other Secret keys.
# Hide the password patch output because API errors can contain patch contents.
if ! k3s kubectl -n argocd patch secret argocd-secret --type=merge --patch-file "$work/password.json" > "$work/password-patch.log" 2>&1; then
  echo 'Failed to patch argocd-secret; inspect the Secret and permissions on the VPS.' >&2
  exit 1
fi
k3s kubectl -n argocd patch configmap argocd-cm --type=merge --patch-file "$work/cm.json"
k3s kubectl -n argocd patch configmap argocd-cmd-params-cm --type=merge --patch-file "$work/params.json"
k3s kubectl -n argocd rollout restart deployment/argocd-server
k3s kubectl -n argocd rollout status deployment/argocd-server --timeout=180s

# 8. Enable HTTPS before exposing the UI Ingress.
# Use HTTP-01 with cert-manager's built-in Ingress solver during certificate provisioning.
k3s kubectl -n argocd apply -f "$work/certificate.yaml"
k3s kubectl -n argocd wait --for=condition=Ready certificate/argocd-ui-tls --timeout=300s
k3s kubectl -n argocd apply -f "$work/ingress.yaml"
echo 'ArgoCD configuration complete.'
