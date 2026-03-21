#!/usr/bin/env bash

set -euo pipefail

[ "${EUID}" -eq 0 ] || {
  echo "run this script as root" >&2
  exit 1
}

repo_url="${GITHUB_REPOSITORY_URL:?GITHUB_REPOSITORY_URL is required}"
runner_token="${GITHUB_RUNNER_TOKEN:?GITHUB_RUNNER_TOKEN is required}"
runner_version="${GITHUB_RUNNER_VERSION:?GITHUB_RUNNER_VERSION is required}"
runner_user="${GITHUB_RUNNER_USER:?GITHUB_RUNNER_USER is required}"
runner_home="${GITHUB_RUNNER_HOME:?GITHUB_RUNNER_HOME is required}"
runner_name="${GITHUB_RUNNER_NAME:?GITHUB_RUNNER_NAME is required}"
runner_labels="${GITHUB_RUNNER_LABELS:?GITHUB_RUNNER_LABELS is required}"

archive="actions-runner-linux-x64-${runner_version}.tar.gz"
url="https://github.com/actions/runner/releases/download/v${runner_version}/${archive}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

apt-get update
apt-get install -y curl tar git

require curl
require tar
require git

if ! getent group docker >/dev/null 2>&1; then
  echo "docker group does not exist. install Docker before installing the runner" >&2
  exit 1
fi

if ! id "$runner_user" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$runner_user"
fi

usermod -aG docker "$runner_user"

mkdir -p "$runner_home"
chown -R "$runner_user:$runner_user" "$runner_home"

if [ ! -f "$runner_home/config.sh" ]; then
  sudo -u "$runner_user" bash <<EOF
set -euo pipefail
cd "$runner_home"
curl -L -o "$archive" "$url"
tar xzf "$archive"
rm -f "$archive"
EOF
fi

if [ -f "$runner_home/.runner" ]; then
  echo "runner is already configured in $runner_home" >&2
  exit 1
fi

sudo -u "$runner_user" bash <<EOF
set -euo pipefail
cd "$runner_home"
./config.sh \
  --url "$repo_url" \
  --token "$runner_token" \
  --name "$runner_name" \
  --labels "$runner_labels" \
  --unattended
EOF

cd "$runner_home"
./svc.sh install "$runner_user"
./svc.sh start

echo "runner installed"
echo "home: $runner_home"
echo "name: $runner_name"
echo "labels: $runner_labels"
