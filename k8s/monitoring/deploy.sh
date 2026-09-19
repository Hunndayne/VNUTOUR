#!/usr/bin/env bash
# GitHub runner entrypoint: validate inputs, build a private payload, then run
# k8s/monitoring/install/install.sh on the VPS through one verified SSH connection.
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
[[ ${1:-} == --deploy ]] || {
  echo 'Usage: deploy.sh --prepare-tools | --deploy' >&2
  exit 2
}

echo
echo '========== [MONITORING RUNNER 2/4] Validate Variables and Secrets =========='
: "${GRAFANA_ADMIN_PASSWORD:?Missing GRAFANA_ADMIN_PASSWORD}"
: "${VPS_SSH_HOST:?Missing VPS_SSH_HOST}"
: "${VPS_SSH_USER:?Missing VPS_SSH_USER}"
: "${VPS_SSH_PASSWORD:?Missing VPS_SSH_PASSWORD}"
: "${VPS_SSH_KNOWN_HOSTS:?Missing VPS_SSH_KNOWN_HOSTS}"
VPS_SSH_PORT=${VPS_SSH_PORT:-22}
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
  printf '::add-mask::%s\n' "$VPS_SSH_HOST"
fi
echo '[input] SSH configuration and protected passwords passed validation'

echo
echo '========== [MONITORING RUNNER 3/4] Build temporary SSH payload =========='
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/monitoring-deploy.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/payload/install" "$work/payload/dashboard"
cp "$here/install/install.sh" "$here/install/values.yaml" "$work/payload/install/"
cp "$here/dashboard/15282_rev1.json" "$work/payload/dashboard/"
printf '%s' "$GRAFANA_ADMIN_PASSWORD" > "$work/payload/grafana-admin-password"
printf '%s\n' "$VPS_SSH_PASSWORD" > "$work/ssh-password"
printf '%s\n' "$VPS_SSH_KNOWN_HOSTS" > "$work/known_hosts"
unset GRAFANA_ADMIN_PASSWORD VPS_SSH_PASSWORD VPS_SSH_KNOWN_HOSTS
echo '[payload] Script, values, reviewed dashboard and protected Grafana password are ready'

remote_commands=$(cat <<'SSH'
set -eu
umask 077
task_dir=$(mktemp -d /tmp/monitoring-bootstrap.XXXXXXXX)
trap 'rm -rf -- "$task_dir"' EXIT
tar -xzf - -C "$task_dir"
if [ "$(id -u)" -eq 0 ]; then
  GRAFANA_ADMIN_PASSWORD_FILE="$task_dir/grafana-admin-password" \
    bash "$task_dir/install/install.sh"
else
  sudo -n env GRAFANA_ADMIN_PASSWORD_FILE="$task_dir/grafana-admin-password" \
    bash "$task_dir/install/install.sh"
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
