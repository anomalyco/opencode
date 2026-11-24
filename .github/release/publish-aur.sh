#!/usr/bin/env bash
# publish-aur.sh <build-npm dir>: updates opencode-beta on the AUR over SSH (AUR_KEY, pinned host key) and
# registers the aur update artifact.
. "$(dirname "$0")/lib.sh"

if ! dry_run; then
  umask 077
  ssh_dir=$(mktemp -d)
  trap 'rm -rf "$ssh_dir"' EXIT
  printf '%s\n' "$AUR_KEY" > "$ssh_dir/key"
  unset AUR_KEY
  echo "aur.archlinux.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEuBKrPzbawxA/k2g6NcyV5jmqwJ2s+zpgZGZ7tpLIcN" > "$ssh_dir/known_hosts"
  export GIT_SSH_COMMAND="ssh -i $ssh_dir/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ssh_dir/known_hosts"
fi
push_git ssh://aur@aur.archlinux.org/opencode-bin.git "chore: update opencode-bin to $OPENCODE_VERSION" \
  bash "$release_dir/render-aur.sh" "$1"
