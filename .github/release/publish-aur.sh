#!/usr/bin/env bash
# publish-aur.sh <build-npm dir>: updates opencode-beta on the AUR over SSH (AUR_KEY, pinned host key) and
# registers the aur update artifact.
. "$(dirname "$0")/lib.sh"

if ! dry_run; then
  mkdir -p ~/.ssh
  printf '%s\n' "$AUR_KEY" > ~/.ssh/aur
  chmod 600 ~/.ssh/aur
  echo "aur.archlinux.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEuBKrPzbawxA/k2g6NcyV5jmqwJ2s+zpgZGZ7tpLIcN" > ~/.ssh/known_hosts
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/aur -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
fi
push_git ssh://aur@aur.archlinux.org/opencode-beta.git "chore: update opencode-beta to ${OPENCODE_VERSION//-/.}" \
  bash "$release_dir/render-aur.sh" "$1"
publish_update cli aur '{"package": "opencode-beta"}'
