#!/usr/bin/env bash
# Install or reconcile kube-prometheus-stack on the existing k3s VPS.
# Executed as root by k8s/monitoring/deploy.sh over SSH; safe to run repeatedly.
set -euo pipefail
set +x
umask 077
export LC_ALL=C

# Change versions only after reviewing upstream upgrade notes. Helm does not
# upgrade CRDs automatically, so chart upgrades need a separate migration.
chart_version=91.4.1
chart=oci://ghcr.io/prometheus-community/charts/kube-prometheus-stack
release=monitoring
namespace=monitoring
helm_version=4.3.0
helm_sha256=86584a54def73570558f66f5111cc53dfed56689637ae32c1201205d494f54fb
dashboard_sha256=e331a33cf52ffbf291abc089c9122e654848e57d40e6410c34012276499cb6de
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dashboard_file="$script_dir/../dashboard/15282_rev1.json"

echo
echo '========== [MONITORING VPS 1/8] Check VPS and required tools =========='
if [[ $(id -u) != 0 ]]; then
  echo '[error] Run this script as root or through sudo -n.' >&2
  exit 1
fi
if ! command -v k3s >/dev/null; then
  echo '[error] k3s is missing. This script only configures an existing k3s cluster.' >&2
  exit 1
fi
k3s_kubeconfig=${K3S_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}
if [[ ! -r $k3s_kubeconfig ]]; then
  echo "[error] Cannot read k3s kubeconfig: $k3s_kubeconfig" >&2
  exit 1
fi
export KUBECONFIG=$k3s_kubeconfig

# Install Debian/Ubuntu packages only when the corresponding command is absent.
# Package installation is grouped behind one apt update.
missing_packages=()
for command_package in curl:curl jq:jq tar:tar gzip:gzip sha256sum:coreutils; do
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
  command -v apt-get >/dev/null || {
    echo '[error] Missing tools require apt-get, but this host is not Debian/Ubuntu.' >&2
    exit 1
  }
  echo "[tool] Updating apt metadata once for: ${missing_packages[*]}"
  apt-get update -qq
  apt-get install -y --no-upgrade "${missing_packages[@]}"
  echo '[tool] Missing OS packages installed successfully'
fi

# Preserve an existing Helm 4 installation. On a fresh AMD64 VPS, install a
# pinned official binary only after its SHA-256 checksum passes.
work=$(mktemp -d /tmp/monitoring-install.XXXXXXXX)
trap 'rm -rf -- "$work"' EXIT
if command -v helm >/dev/null; then
  echo '[tool] helm: already installed; keeping the existing Helm 4 binary'
else
  [[ $(uname -m) == x86_64 ]] || {
    echo '[error] Automatic Helm installation currently supports Linux AMD64 only.' >&2
    exit 1
  }
  echo "[tool] helm: missing; installing pinned Helm v$helm_version"
  helm_archive="helm-v$helm_version-linux-amd64.tar.gz"
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 120 \
    "https://get.helm.sh/$helm_archive" -o "$work/$helm_archive"
  printf '%s  %s\n' "$helm_sha256" "$work/$helm_archive" | sha256sum --check --status || {
    echo '[error] Helm archive checksum does not match the pinned value.' >&2
    exit 1
  }
  tar -xzf "$work/$helm_archive" -C "$work"
  install -m 0755 "$work/linux-amd64/helm" /usr/local/bin/helm
  echo "[tool] Helm v$helm_version installed at /usr/local/bin/helm"
fi
current_helm_version=$(helm version --short)
[[ $current_helm_version == v4.* ]] || {
  echo "[error] Helm 4 is required; found $current_helm_version" >&2
  exit 1
}
echo "[version] $current_helm_version"
echo "[version] $(k3s --version | head -n 1)"
echo "[version] $(curl --version | head -n 1)"
echo "[version] $(jq --version)"

echo
echo '========== [MONITORING VPS 2/8] Check cluster access and storage =========='
echo "[cluster] context: $(k3s kubectl config current-context)"
k3s kubectl get nodes -o wide
if k3s kubectl get storageclass local-path >/dev/null 2>&1; then
  echo '[resource] storageclass/local-path: already exists'
else
  echo '[error] storageclass/local-path is required for Prometheus and Grafana PVCs.' >&2
  exit 1
fi

echo
echo '========== [MONITORING VPS 3/8] Check namespace and Helm ownership =========='
if k3s kubectl get namespace "$namespace" >/dev/null 2>&1; then
  echo "[resource] namespace/$namespace: already exists"
  namespace_exists=true
else
  echo "[resource] namespace/$namespace: missing; it will be created after safety checks"
  namespace_exists=false
fi

# Never adopt the repository's legacy manifest-based stack automatically: its
# ownership and PVC layout differ from this Helm release.
legacy=''
if [[ $namespace_exists == true ]]; then
  legacy=$(k3s kubectl -n "$namespace" get deployment prometheus grafana kube-state-metrics \
    --ignore-not-found -o name)
  legacy+=$(k3s kubectl -n "$namespace" get daemonset node-exporter --ignore-not-found -o name)
fi
if [[ -n $legacy ]]; then
  echo '[error] Legacy monitoring resources were found; migration must be planned first:' >&2
  printf '%s\n' "$legacy" >&2
  exit 1
fi

installed_chart=$(helm list -n "$namespace" --all --filter "^${release}$" -o json \
  | jq -r '.[0].chart // empty')
if [[ -z $installed_chart ]]; then
  echo "[resource] Helm release $namespace/$release: missing; a new release will be installed"
  release_exists=false
elif [[ $installed_chart == "kube-prometheus-stack-$chart_version" ]]; then
  echo "[resource] Helm release $namespace/$release: already uses $installed_chart; values will be reconciled"
  release_exists=true
else
  echo "[error] Existing release uses $installed_chart, expected kube-prometheus-stack-$chart_version." >&2
  echo '[error] Review chart upgrade notes and CRD migration before changing versions.' >&2
  exit 1
fi

echo
echo '========== [MONITORING VPS 4/8] Check Prometheus Operator CRDs =========='
# A partial CRD set indicates an interrupted/manual install. Continuing could
# leave incompatible schemas, so repair and adoption remain explicit work.
prometheus_crds=(
  alertmanagerconfigs.monitoring.coreos.com
  alertmanagers.monitoring.coreos.com
  podmonitors.monitoring.coreos.com
  probes.monitoring.coreos.com
  prometheusagents.monitoring.coreos.com
  prometheuses.monitoring.coreos.com
  prometheusrules.monitoring.coreos.com
  scrapeconfigs.monitoring.coreos.com
  servicemonitors.monitoring.coreos.com
  thanosrulers.monitoring.coreos.com
)
existing_crds=0
for crd in "${prometheus_crds[@]}"; do
  if k3s kubectl get crd "$crd" >/dev/null 2>&1; then
    echo "[resource] crd/$crd: already exists"
    ((existing_crds += 1))
  else
    echo "[resource] crd/$crd: missing"
  fi
done
if (( existing_crds == 0 )) && [[ $release_exists == false ]]; then
  echo '[resource] No monitoring CRDs exist; Helm will install the complete pinned set'
  helm_crd_option=()
elif (( existing_crds == ${#prometheus_crds[@]} )) && [[ $release_exists == true ]]; then
  echo '[resource] Complete CRD set belongs to the existing release; CRD installation will be skipped'
  helm_crd_option=(--skip-crds)
else
  echo "[error] Found $existing_crds/${#prometheus_crds[@]} monitoring CRDs with release_exists=$release_exists." >&2
  echo '[error] Refusing to adopt or repair CRD ownership automatically.' >&2
  exit 1
fi

echo
echo '========== [MONITORING VPS 5/8] Validate chart and dashboard =========='
[[ -f $dashboard_file ]] || {
  echo "[error] Dashboard file is missing: $dashboard_file" >&2
  exit 1
}
printf '%s  %s\n' "$dashboard_sha256" "$dashboard_file" | sha256sum --check --status || {
  echo '[error] Dashboard checksum does not match the reviewed revision.' >&2
  exit 1
}
echo '[check] Dashboard 15282 revision 1 checksum: valid'
helm pull "$chart" --version "$chart_version" --destination "$work"
package="$work/kube-prometheus-stack-$chart_version.tgz"
helm template "$release" "$package" -n "$namespace" -f "$script_dir/values.yaml" \
  > "$work/rendered.yaml"
echo "[check] kube-prometheus-stack $chart_version rendered successfully"
jq 'walk(if type == "string" then gsub("\\$\\{DS_PROMETHEUS\\}"; "prometheus") else . end)
  | del(.__inputs) | .id = null' "$dashboard_file" > "$work/k3s-15282.json"

echo
echo '========== [MONITORING VPS 6/8] Reconcile Grafana credentials and dashboard =========='
# Namespace creation is deliberately delayed until chart, dashboard, release and
# CRD safety checks have all passed.
if [[ $namespace_exists == false ]]; then
  k3s kubectl create namespace "$namespace"
  echo "[resource] namespace/$namespace: created"
fi

# The admin Secret is created only once. Later runs preserve it and Grafana's
# persisted database. Password rotation remains a separate operation.
if k3s kubectl -n "$namespace" get secret monitoring-grafana-admin >/dev/null 2>&1; then
  echo '[resource] secret/monitoring-grafana-admin: already exists; keeping it unchanged'
else
  echo '[resource] secret/monitoring-grafana-admin: missing; creating it'
  password_file=${GRAFANA_ADMIN_PASSWORD_FILE:-}
  [[ -n $password_file && -r $password_file ]] || {
    echo '[error] GRAFANA_ADMIN_PASSWORD_FILE must point to the protected pipeline file on first install.' >&2
    exit 1
  }
  jq -e -Rs 'length >= 16 and length <= 128 and (contains("\n") | not) and (contains("\r") | not)' \
    "$password_file" >/dev/null || {
      echo '[error] Grafana password must be 16-128 characters without a newline.' >&2
      exit 1
    }
  printf '%s' admin > "$work/admin-user"
  k3s kubectl -n "$namespace" create secret generic monitoring-grafana-admin \
    --from-file=admin-user="$work/admin-user" --from-file=admin-password="$password_file" \
    --dry-run=client -o yaml > "$work/grafana-secret.yaml"
  if ! k3s kubectl create -f "$work/grafana-secret.yaml" > "$work/secret-result" 2>&1; then
    echo '[error] Could not create Grafana Secret; raw API output is hidden to protect credentials.' >&2
    exit 1
  fi
  echo '[resource] secret/monitoring-grafana-admin: created'
fi

if k3s kubectl -n "$namespace" get configmap monitoring-dashboard-15282 >/dev/null 2>&1; then
  echo '[resource] configmap/monitoring-dashboard-15282: exists; reconciling reviewed dashboard content'
else
  echo '[resource] configmap/monitoring-dashboard-15282: missing; creating it'
fi
k3s kubectl -n "$namespace" create configmap monitoring-dashboard-15282 \
  --from-file=k3s-15282.json="$work/k3s-15282.json" --dry-run=client -o json \
  | jq '.metadata.labels.grafana_dashboard = "1"' \
  | k3s kubectl apply -f -

echo
echo '========== [MONITORING VPS 7/8] Reconcile kube-prometheus-stack =========='
# `upgrade --install` creates missing chart-owned resources and reconciles
# existing ones without producing duplicate Deployments, Services or PVCs.
helm upgrade --install "$release" "$package" -n "$namespace" \
  "${helm_crd_option[@]}" --reset-values -f "$script_dir/values.yaml" \
  --wait --timeout 10m --history-max 5
echo "[resource] Helm release $namespace/$release: reconciled successfully"

echo
echo '========== [MONITORING VPS 8/8] Wait for workloads and print inventory =========='
k3s kubectl -n "$namespace" rollout status deployment/monitoring-operator --timeout=300s
k3s kubectl -n "$namespace" rollout status deployment/monitoring-grafana --timeout=300s
prometheus_sts=''
for ((attempt = 0; attempt < 60; attempt++)); do
  prometheus_sts=$(k3s kubectl -n "$namespace" get statefulset prometheus-monitoring-prometheus \
    --ignore-not-found -o name)
  [[ -n $prometheus_sts ]] && break
  sleep 5
done
[[ -n $prometheus_sts ]] || {
  echo '[error] Prometheus Operator did not create statefulset/prometheus-monitoring-prometheus.' >&2
  exit 1
}
k3s kubectl -n "$namespace" rollout status statefulset/prometheus-monitoring-prometheus --timeout=300s
k3s kubectl -n "$namespace" get pods,pvc,svc

cat <<'EOF'

[success] Monitoring baseline is ready.
[next] From the VPS, keep these commands running when testing through SSH tunnels:
  k3s kubectl -n monitoring port-forward --address 127.0.0.1 svc/monitoring-grafana 3000:80
  k3s kubectl -n monitoring port-forward --address 127.0.0.1 svc/monitoring-prometheus 9090:9090
EOF
