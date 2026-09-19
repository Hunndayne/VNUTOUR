#!/usr/bin/env bash
# GitHub runner entrypoint: validate inputs, build a private payload, then run
# monitoring-install.sh on the VPS through one verified SSH connection.
set -euo pipefail
set +x
umask 077
export LC_ALL=C

echo
echo '========== [MONITORING RUNNER 1/4] Check deployment tools =========='
missing_packages=()
for command_package in curl:curl jq:jq ssh:openssh-client sshpass:sshpass tar:tar shellcheck:shellcheck; do
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
  echo "[tool] Installing missing runner packages: ${missing_packages[*]}"
  sudo apt-get update -qq
  sudo apt-get install -y --no-upgrade "${missing_packages[@]}"
  echo '[tool] Missing runner packages installed successfully'
fi
echo "[version] $(bash --version | head -n 1)"
echo "[version] $(ssh -V 2>&1)"
echo "[version] $(sshpass -V | head -n 1)"
echo "[version] $(jq --version)"

if [[ ${1:-} == --prepare-tools ]]; then
  echo '[success] Runner tools are ready'
  exit 0
fi

validate_grafana_hostname() {
  [[ ${GRAFANA_HOSTNAME:-} =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || {
    echo '[error] GRAFANA_HOSTNAME must be a lowercase DNS hostname without scheme, port or path.' >&2
    exit 1
  }
}

if [[ ${1:-} == --verify ]]; then
  echo
  echo '========== [MONITORING RUNNER VERIFY] Check Grafana HTTPS =========='
  : "${GRAFANA_HOSTNAME:?Missing GRAFANA_HOSTNAME}"
  validate_grafana_hostname
  if [[ ${GITHUB_ACTIONS:-false} == true ]]; then
    printf '::add-mask::%s\n' "$GRAFANA_HOSTNAME"
  fi
  work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/monitoring-verify.XXXXXXXX")
  trap 'rm -rf -- "$work"' EXIT
  url="https://$GRAFANA_HOSTNAME"
  curl --fail --silent --show-error --max-time 30 --retry 6 --retry-delay 5 --retry-all-errors \
    "$url/api/health" -o "$work/health.json"
  jq -e '.database == "ok"' "$work/health.json" >/dev/null
  code=$(curl --silent --show-error --max-time 30 -D "$work/headers" -o /dev/null \
    -w '%{http_code}' "http://$GRAFANA_HOSTNAME/")
  if [[ ! $code =~ ^30[1278]$ ]] || ! grep -Fiq "location: $url/" "$work/headers"; then
    echo '[error] Grafana HTTP endpoint must redirect to its HTTPS hostname.' >&2
    exit 1
  fi
  code=$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' "$url/api/search")
  if [[ $code != 401 && $code != 403 ]]; then
    echo '[error] Grafana anonymous API access was not denied.' >&2
    exit 1
  fi
  echo '[success] Grafana HTTPS, health, redirect and anonymous-access checks passed'
  exit 0
fi

[[ ${1:-} == --deploy ]] || {
  echo 'Usage: deploy.sh --prepare-tools | --deploy | --verify' >&2
  exit 2
}

echo
echo '========== [MONITORING RUNNER 2/4] Validate Variables and Secrets =========='
: "${GRAFANA_HOSTNAME:?Missing GRAFANA_HOSTNAME}"
: "${GRAFANA_ADMIN_PASSWORD:?Missing GRAFANA_ADMIN_PASSWORD}"
: "${VPS_SSH_HOST:?Missing VPS_SSH_HOST}"
: "${VPS_SSH_USER:?Missing VPS_SSH_USER}"
: "${VPS_SSH_PASSWORD:?Missing VPS_SSH_PASSWORD}"
: "${VPS_SSH_KNOWN_HOSTS:?Missing VPS_SSH_KNOWN_HOSTS}"
VPS_SSH_PORT=${VPS_SSH_PORT:-22}
validate_grafana_hostname
if [[ ! $VPS_SSH_HOST =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] ||
   [[ ! $VPS_SSH_USER =~ ^[a-z_][a-z0-9_-]*$ ]] ||
   [[ ! $VPS_SSH_PORT =~ ^[1-9][0-9]{0,4}$ ]] || (( VPS_SSH_PORT > 65535 )); then
  echo '[error] Invalid VPS SSH host, user or port.' >&2
  exit 1
fi
if (( ${#GRAFANA_ADMIN_PASSWORD} < 16 || ${#GRAFANA_ADMIN_PASSWORD} > 128 )) ||
   [[ $GRAFANA_ADMIN_PASSWORD == *$'\n'* || $GRAFANA_ADMIN_PASSWORD == *$'\r'* ]] ||
   [[ $VPS_SSH_PASSWORD == *$'\n'* || $VPS_SSH_PASSWORD == *$'\r'* ]]; then
  echo '[error] Grafana password must be 16-128 characters; passwords cannot contain newlines.' >&2
  exit 1
fi
if [[ ${GITHUB_ACTIONS:-false} == true ]]; then
  printf '::add-mask::%s\n' "$GRAFANA_HOSTNAME" "$VPS_SSH_HOST"
fi
echo '[input] Grafana hostname, SSH configuration and protected passwords passed validation'

echo
echo '========== [MONITORING RUNNER 3/4] Build temporary SSH payload =========='
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/monitoring-deploy.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/payload/install" "$work/payload/dashboard"
cp "$here/monitoring-install.sh" "$here/values.yaml" \
  "$here/ingress-values.yaml" "$here/certificate.yaml" \
  "$here/ingress.yaml" "$work/payload/install/"
dashboard_source="$here/../dashboard/vps_k3s_dashboard.json"
jq -S -c . "$dashboard_source" > "$work/payload/dashboard/vps_k3s_dashboard.json" || {
  echo '[error] Dashboard is not valid JSON and cannot be added to the SSH payload.' >&2
  exit 1
}
echo '[payload] Dashboard JSON validated and canonicalized with jq -S -c .'
printf '%s' "$GRAFANA_ADMIN_PASSWORD" > "$work/payload/grafana-admin-password"
printf '%s' "$GRAFANA_HOSTNAME" > "$work/payload/grafana-hostname"
printf '%s\n' "$VPS_SSH_PASSWORD" > "$work/ssh-password"
printf '%s\n' "$VPS_SSH_KNOWN_HOSTS" > "$work/known_hosts"
unset GRAFANA_ADMIN_PASSWORD VPS_SSH_PASSWORD VPS_SSH_KNOWN_HOSTS
echo '[payload] Script, values, TLS/Ingress templates, dashboard and protected inputs are ready'

remote_commands=$(cat <<'SSH'
set -eu
umask 077
task_dir=$(mktemp -d /tmp/monitoring-bootstrap.XXXXXXXX)
trap 'rm -rf -- "$task_dir"' EXIT
tar -xzf - -C "$task_dir"
if [ "$(id -u)" -eq 0 ]; then
  GRAFANA_ADMIN_PASSWORD_FILE="$task_dir/grafana-admin-password" \
    GRAFANA_HOSTNAME_FILE="$task_dir/grafana-hostname" \
    bash "$task_dir/install/monitoring-install.sh"
else
  sudo -n env GRAFANA_ADMIN_PASSWORD_FILE="$task_dir/grafana-admin-password" \
    GRAFANA_HOSTNAME_FILE="$task_dir/grafana-hostname" \
    bash "$task_dir/install/monitoring-install.sh"
fi
SSH
)

echo
echo '========== [MONITORING RUNNER 4/4] Bootstrap monitoring on VPS =========='
tar -czf - -C "$work/payload" . |
  sshpass -f "$work/ssh-password" ssh \
    -p "$VPS_SSH_PORT" \
    -o StrictHostKeyChecking=yes \
    -o "UserKnownHostsFile=$work/known_hosts" \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    -o BatchMode=no \
    -o NumberOfPasswordPrompts=1 \
    -o ConnectTimeout=15 \
    "$VPS_SSH_USER@$VPS_SSH_HOST" "$remote_commands"
echo '[success] Monitoring deployment over SSH completed'
