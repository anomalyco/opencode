#!/bin/sh
# Container entrypoint for the collab fork.
#
# Claude credentials lifecycle:
#
#   Local dev (docker-compose)
#       docker-compose.yml bind-mounts ~/.claude/.credentials.json:ro from
#       the host into /home/opencode/.claude/.credentials.json.  No env var
#       is set; this script's CLAUDE_CREDENTIALS_JSON branch is skipped.
#
#   ECS Fargate
#       Credentials live on EFS at /home/opencode/.local/share/opencode/
#       claude-credentials.json (the SQLite volume).  Two seeding paths:
#         a) First-boot seed from Secrets Manager via
#            $CLAUDE_CREDENTIALS_JSON.  Used until the file exists on EFS.
#         b) Any subsequent boot.  The EFS file already has the freshest
#            tokens (either the plugin refreshed them or an operator
#            uploaded via the UI), so we don't overwrite it.
#
#       The canonical path ~/.claude/.credentials.json is a SYMLINK to the
#       EFS file, so plugin token-refresh writes land on EFS and survive
#       container replacement.  Without the symlink, every ECS task would
#       start with the (potentially stale) Secrets Manager value and lose
#       any in-process refresh on restart.
#
# Operator credential rotation:
#   1. Use the in-app UI (any unleashlive org member can paste their Mac's
#      credentials JSON at /collab/new).  Atomic-writes to EFS.
#   2. OR update the Secrets Manager entry + delete the EFS file (the next
#      task boot re-seeds from Secrets Manager).

set -eu

# Resolve the home dir from $HOME (set by the Dockerfile to /home/opencode
# under ADR-0003).  Falls back to /home/opencode if unset, which is the
# only correct path post-ADR.  /root/... would mean we're still root —
# entrypoint logs would show a chown error and the credential write would
# 500 the auth plugin until ECS replaces the task.
HOME_DIR="${HOME:-/home/opencode}"
CANONICAL="$HOME_DIR/.claude/.credentials.json"
EFS_CREDS="$HOME_DIR/.local/share/opencode/claude-credentials.json"

mkdir -p "$HOME_DIR/.claude" "$(dirname "$EFS_CREDS")"

# ECS path: env var present.  Seed EFS on first boot if empty, then symlink.
# Local path: env var unset.  Either the bind-mount provides credentials at
# CANONICAL or the user has no Claude auth (Anthropic API key path).
if [ -n "${CLAUDE_CREDENTIALS_JSON:-}" ]; then
  if [ ! -s "$EFS_CREDS" ]; then
    printf '%s' "$CLAUDE_CREDENTIALS_JSON" > "$EFS_CREDS"
    chmod 0600 "$EFS_CREDS"
    echo "[entrypoint] seeded $EFS_CREDS from CLAUDE_CREDENTIALS_JSON ($(wc -c < "$EFS_CREDS") bytes)"
  else
    echo "[entrypoint] $EFS_CREDS already present ($(wc -c < "$EFS_CREDS") bytes) — keeping existing"
  fi
  # Always (re)link CANONICAL → EFS so plugin refresh writes hit the
  # persistent file.  -L: remove if it's any kind of symlink already;
  # -f also handles the case where it was a regular file from a prior
  # entrypoint version.
  rm -f "$CANONICAL"
  ln -s "$EFS_CREDS" "$CANONICAL"
fi

# Git "dubious ownership" workaround.  EFS access points (terraform/opencode-
# collab/efs.tf) currently mount with uid=0/gid=0, while the container runs
# as uid 10001 (ADR-0003).  Git 2.35+ refuses operations on a repo whose
# .git directory isn't owned by the current uid — clone works because git
# creates the .git dir itself, but subsequent push/log/diff calls fail with
# "fatal: detected dubious ownership".  Wildcard '*' tells git to trust any
# directory; safe enough on this single-tenant container.
# Proper fix is to align the EFS access point posix_user.uid with the
# container uid; tracked separately.
git config --global --add safe.directory '*'

# Hand off to the real server.  $@ propagates whatever args ECS / CMD passed.
exec bun run --cwd packages/opencode src/index.ts serve \
  --port 4096 --hostname 0.0.0.0 --print-logs "$@"
