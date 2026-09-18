#!/usr/bin/env bash
# Check for the tool → install if missing → create manifest/patch → send via SSH
# Runs on a GitHub runner (Ubuntu). Read and execute sequentially from top to bottom.
set +x # Do not print passwords when the workflow enables debug shell.
set -euo pipefail
umask 077 # Temporary files are readable only by the current user.
export LC_ALL=C

# 1. Install only missing tools, then print their versions for verification in logs.
if ! command -v jq > /dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-upgrade jq
fi
if ! command -v curl > /dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-upgrade curl
fi
if ! command -v ssh > /dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-upgrade openssh-client
fi
if ! command -v sshpass > /dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-upgrade sshpass
fi
if ! command -v htpasswd > /dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-upgrade apache2-utils
fi
if ! command -v shellcheck > /dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-upgrade shellcheck
fi

# Verify the version
bash --version
jq --version
curl --version
ssh -V
sshpass -V
tar --version
dpkg-query -W apache2-utils # htpasswd does not have a --version option.
shellcheck --version

# Workflow uses this step to prepare tools before passing Secrets.
if [[ ${1:-} == --prepare-tools ]]; then
  exit 0
fi

# 2. Get variables from GitHub Variables/Secrets.
: "${ARGOCD_HOSTNAME:?Missing ARGOCD_HOSTNAME}"
: "${ACME_EMAIL:?Missing ACME_EMAIL}"
: "${ARGOCD_ADMIN_PASSWORD:?Missing ARGOCD_ADMIN_PASSWORD}"
: "${VPS_SSH_HOST:?Missing VPS_SSH_HOST}"
: "${VPS_SSH_USER:?Missing VPS_SSH_USER}"
: "${VPS_SSH_PASSWORD:?Missing VPS_SSH_PASSWORD}"
: "${VPS_SSH_KNOWN_HOSTS:?Missing VPS_SSH_KNOWN_HOSTS}"
VPS_SSH_PORT=${VPS_SSH_PORT:-22}

# Blocking characters can break YAML or SSH commands when replacing placeholders.
if [[ ! $ARGOCD_HOSTNAME =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] ||
   [[ ! $ACME_EMAIL =~ ^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] ||
   [[ ! $VPS_SSH_HOST =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] ||
   [[ ! $VPS_SSH_USER =~ ^[a-z_][a-z0-9_-]*$ ]] ||
   [[ ! $VPS_SSH_PORT =~ ^[1-9][0-9]{0,4}$ ]] || (( VPS_SSH_PORT > 65535 )); then
  echo 'Invalid hostname, email or SSH configuration.' >&2
  exit 1
fi
if (( ${#ARGOCD_ADMIN_PASSWORD} < 16 || ${#ARGOCD_ADMIN_PASSWORD} > 72 )) ||
   [[ $ARGOCD_ADMIN_PASSWORD == *$'\n'* || $ARGOCD_ADMIN_PASSWORD == *$'\r'* ]] ||
   [[ $VPS_SSH_PASSWORD == *$'\n'* || $VPS_SSH_PASSWORD == *$'\r'* ]]; then
  echo 'UI password must be 16-72 bytes; passwords cannot contain newlines.' >&2
  exit 1
fi
if [[ ${GITHUB_ACTIONS:-false} == true ]]; then
  printf '::add-mask::%s\n' "$ARGOCD_HOSTNAME" "$ACME_EMAIL" "$VPS_SSH_HOST"
fi

# 3. Create a dedicated directory. Automatically delete the password file, patch, and token when the script finishes.
here=$(cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/argocd-deploy.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/payload"
printf '%s\n' "$VPS_SSH_KNOWN_HOSTS" > "$work/known_hosts"
printf '%s\n' "$VPS_SSH_PASSWORD" > "$work/ssh-password"
unset VPS_SSH_PASSWORD VPS_SSH_KNOWN_HOSTS

# 4. Replace the hostname/email in the manifest; the file in Git contains only a placeholder.
sed "s/argocd.example.invalid/$ARGOCD_HOSTNAME/g" "$here/certificate.yaml" > "$work/payload/certificate.yaml"
sed "s/argocd.example.invalid/$ARGOCD_HOSTNAME/g" "$here/ingress.yaml" > "$work/payload/ingress.yaml"
sed "s/acme@example.invalid/$ACME_EMAIL/g" "$here/../../cert-manager-issuer.yaml" > "$work/payload/cluster-issuers.yaml"
cp "$here/bootstrap.sh" "$work/payload/bootstrap.sh"

# 5. Create the patch. Only send the bcrypt hash to the VPS, not the cleartext UI password.
printf '%s\n' "$ARGOCD_ADMIN_PASSWORD" | htpasswd -niBC 12 admin | cut -d: -f2 | tr -d '\n' > "$work/hash"
jq -n --rawfile hash "$work/hash" '{stringData: {
  "admin.password": $hash,
  "admin.passwordMtime": (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
}}' > "$work/payload/password.json"
jq -n '{data: {
  "url": ("https://" + env.ARGOCD_HOSTNAME),
  "admin.enabled": "true",
  "users.anonymous.enabled": "false"
}}' > "$work/payload/cm.json"
cat > "$work/payload/params.json" <<'JSON'
{
  "data": {
    "server.insecure": "false",
    "server.rootpath": "",
    "server.basehref": "/"
  }
}
JSON
jq -n '{username: "admin", password: env.ARGOCD_ADMIN_PASSWORD}' > "$work/login.json"
unset ARGOCD_ADMIN_PASSWORD

# 6. The commands in this heredoc will run on the VPS after a successful SSH.
# The single quote at 'SSH' preserves the variables inside so the VPS reads them itself; the runner does not replace them.
remote_commands=$(cat <<'SSH'
set -eu
umask 077
task_dir=$(mktemp -d /tmp/argocd-bootstrap.XXXXXXXX)
trap 'rm -rf -- "$task_dir"' EXIT
tar -xzf - -C "$task_dir"
if [ "$(id -u)" -eq 0 ]; then
  bash "$task_dir/bootstrap.sh" "$task_dir"
else
  sudo -n bash "$task_dir/bootstrap.sh" "$task_dir"
fi
SSH
)

# sshpass reads the password from a separate file; stdin is used for tar to supply the payload.
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

# 7. Check HTTPS, redirect, and authentication. Do not print tokens/passwords to the log.
url="https://$ARGOCD_HOSTNAME"
curl --fail --silent --show-error --max-time 30 --retry 6 --retry-delay 5 --retry-all-errors "$url/" -o /dev/null
code=$(curl --silent --show-error --max-time 30 -D "$work/headers" -o /dev/null -w '%{http_code}' "http://$ARGOCD_HOSTNAME/")
if [[ ! $code =~ ^30[1278]$ ]] || ! grep -Fiq "location: $url/" "$work/headers"; then
  echo 'HTTP must redirect to the HTTPS hostname.' >&2
  exit 1
fi
code=$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' "$url/api/v1/applications")
if [[ $code != 401 && $code != 403 ]]; then
  echo 'Anonymous access was not denied.' >&2
  exit 1
fi
curl --fail --silent --show-error --max-time 30 -H 'Content-Type: application/json' \
  --data-binary "@$work/login.json" "$url/api/v1/session" -o "$work/session.json"
jq -er '"Authorization: Bearer " + (.token | select(type == "string" and length > 0))' \
  "$work/session.json" > "$work/auth-header"
curl --fail --silent --show-error --max-time 30 -H "@$work/auth-header" "$url/api/v1/applications" -o /dev/null
echo 'ArgoCD HTTPS and authentication checks passed.'
