#!/usr/bin/env bash
# Run on VPS: sudo bash bootstrap.sh /path/to/payload
# The payload consists of files where hostname, email, and password hash have been populated by deploy.sh.
set +x
set -euo pipefail
umask 077
work=${1:?Pass the payload directory}
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 1. Check the existing k3s cluster before installing additional utilities.
echo
echo '========== [ARGOCD VPS 1/8] Check k3s and kubeconfig =========='
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

# 2. Keep existing VPS tools; install only missing packages and log every
# decision. One apt update is enough even when both tools are absent.
echo
echo '========== [ARGOCD VPS 2/8] Check required VPS tools =========='
missing_packages=()
for command_package in jq:jq curl:curl; do
  command_name=${command_package%%:*}
  package_name=${command_package##*:}
  if command -v "$command_name" >/dev/null; then
    echo "[tool] $command_name: already installed"
  else
    echo "[tool] $command_name: missing; package $package_name will be installed"
    missing_packages+=("$package_name")
  fi
done
if (( ${#missing_packages[@]} > 0 )); then
  echo "[tool] Installing missing VPS packages: ${missing_packages[*]}"
  apt-get update -qq
  apt-get install -y --no-upgrade "${missing_packages[@]}"
  echo '[tool] Missing VPS packages installed successfully'
fi
echo "[version] $(jq --version)"
echo "[version] $(curl --version | head -n 1)"

# 3. ArgoCD and ingress-nginx are baseline prerequisites managed elsewhere.
# Confirm each resource exists before applying UI configuration. Secret values
# are never printed.
echo
echo '========== [ARGOCD VPS 3/8] Check ingress-nginx and ArgoCD resources =========='
echo '[resource] Checking ingress-nginx prerequisites'
k3s kubectl get ingressclass nginx >/dev/null
echo '[resource] ingressclass/nginx: exists'
k3s kubectl -n ingress-nginx get deployment ingress-nginx-controller >/dev/null
echo '[resource] ingress-nginx/deployment/ingress-nginx-controller: exists'
echo '[resource] Checking ArgoCD prerequisites'
k3s kubectl -n argocd get deployment argocd-server >/dev/null
echo '[resource] argocd/deployment/argocd-server: exists'
k3s kubectl -n argocd get service argocd-server >/dev/null
echo '[resource] argocd/service/argocd-server: exists'
k3s kubectl -n argocd get configmap argocd-cm argocd-cmd-params-cm argocd-rbac-cm >/dev/null
echo '[resource] Required ArgoCD ConfigMaps: exist'
k3s kubectl -n argocd get secret argocd-secret -o name >/dev/null
echo '[resource] argocd/secret/argocd-secret: exists'

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

# 4. Install cert-manager only when all six CRDs and all deployments are absent.
# A partial installation is stopped for manual review instead of being overwritten.
echo
echo '========== [ARGOCD VPS 4/8] Check or install cert-manager =========='
cert_manager_crds=(
  certificaterequests.cert-manager.io
  certificates.cert-manager.io
  challenges.acme.cert-manager.io
  clusterissuers.cert-manager.io
  issuers.cert-manager.io
  orders.acme.cert-manager.io
)
crds=$(k3s kubectl get crd "${cert_manager_crds[@]}" --ignore-not-found -o name)
crd_count=$(printf '%s\n' "$crds" | sed '/^$/d' | wc -l)
deployments=$(k3s kubectl -n cert-manager get deployments --ignore-not-found -o name)
deployment_count=$(printf '%s\n' "$deployments" | sed '/^$/d' | wc -l)
if (( crd_count == 0 )); then
  if (( deployment_count > 0 )); then
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
  echo '[resource] cert-manager: installed from pinned v1.21.2 manifest'
elif (( crd_count == ${#cert_manager_crds[@]} && deployment_count == 3 )); then
  echo '[resource] cert-manager CRDs and deployments: complete; installation skipped'
else
  echo "[error] Partial cert-manager installation: found $crd_count/${#cert_manager_crds[@]} CRDs and $deployment_count/3 deployments." >&2
  exit 1
fi

# Check current installation, print image/version, and wait for controllers to be ready.
k3s kubectl get crd "${cert_manager_crds[@]}"
k3s kubectl -n cert-manager get deployments -o wide
k3s kubectl -n cert-manager rollout status deployment/cert-manager --timeout=180s
k3s kubectl -n cert-manager rollout status deployment/cert-manager-cainjector --timeout=180s
k3s kubectl -n cert-manager rollout status deployment/cert-manager-webhook --timeout=180s

# 5. Validate manifests with API server before patching ArgoCD configuration.
echo
echo '========== [ARGOCD VPS 5/8] Server-side validate manifests =========='
k3s kubectl apply --dry-run=server -f "$work/cluster-issuers.yaml"
k3s kubectl -n argocd apply --dry-run=server -f "$work/certificate.yaml" -f "$work/ingress.yaml"

# 6. Use the same ClusterIssuer for ArgoCD and subsequent UIs.
echo
echo '========== [ARGOCD VPS 6/8] Reconcile shared ClusterIssuers =========='
k3s kubectl apply -f "$work/cluster-issuers.yaml"
k3s kubectl wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=120s

# 7. Merge only the keys that need to change; preserve RBAC, SSO, and other Secret keys.
# Hide the password patch output because API errors can contain patch contents.
echo
echo '========== [ARGOCD VPS 7/8] Reconcile authentication and server config =========='
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
echo
echo '========== [ARGOCD VPS 8/8] Reconcile TLS certificate and Ingress =========='
k3s kubectl -n argocd apply -f "$work/certificate.yaml"
k3s kubectl -n argocd wait --for=condition=Ready certificate/argocd-ui-tls --timeout=300s
k3s kubectl -n argocd apply -f "$work/ingress.yaml"
echo 'ArgoCD configuration complete.'
