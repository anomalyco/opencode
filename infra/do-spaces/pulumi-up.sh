#!/usr/bin/env bash
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
cd "$dir"

if [ -z "${PULUMI_CONFIG_PASSPHRASE:-}" ]; then
  echo "Set PULUMI_CONFIG_PASSPHRASE (local file backend passphrase for this stack)." >&2
  exit 1
fi

if [ -z "${DIGITALOCEAN_TOKEN:-}" ]; then
  cfg="${DOCTL_CONFIG:-$HOME/Library/Application Support/doctl/config.yaml}"
  if [ -f "$cfg" ]; then
    DIGITALOCEAN_TOKEN="$(python3 -c "import yaml; print(yaml.safe_load(open('$cfg'))['access-token'])")"
    export DIGITALOCEAN_TOKEN
  fi
fi
if [ -z "${DIGITALOCEAN_TOKEN:-}" ]; then
  echo "Set DIGITALOCEAN_TOKEN or configure doctl." >&2
  exit 1
fi

if [ -z "${SPACES_ACCESS_KEY_ID:-}" ] || [ -z "${SPACES_SECRET_ACCESS_KEY:-}" ]; then
  echo "Spaces API needs SPACES_ACCESS_KEY_ID and SPACES_SECRET_ACCESS_KEY (create in DO → API → Spaces keys)." >&2
  exit 1
fi

pulumi login --local
pulumi stack select prod
pulumi up "$@"
