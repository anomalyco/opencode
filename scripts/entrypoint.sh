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

# Optional env-seed: if Secrets Manager (or any other shipping mechanism) put
# the credentials JSON in $CLAUDE_CREDENTIALS_JSON, write it to EFS on first
# boot.  Subsequent boots skip this so UI-uploaded creds aren't clobbered.
if [ -n "${CLAUDE_CREDENTIALS_JSON:-}" ] && [ ! -s "$EFS_CREDS" ]; then
  printf '%s' "$CLAUDE_CREDENTIALS_JSON" > "$EFS_CREDS"
  chmod 0600 "$EFS_CREDS"
  echo "[entrypoint] seeded $EFS_CREDS from CLAUDE_CREDENTIALS_JSON ($(wc -c < "$EFS_CREDS") bytes)"
elif [ -s "$EFS_CREDS" ]; then
  echo "[entrypoint] $EFS_CREDS already present ($(wc -c < "$EFS_CREDS") bytes) — keeping existing"
fi

# Symlink the canonical path to EFS in two cases:
#   (a) the EFS file exists (env-seeded above, persisted from a prior boot,
#       OR uploaded via the UI at /collab/new on a prior run), OR
#   (b) the env var is set on this boot (covers a brand-new ECS task that's
#       about to be seeded; we link first so writeCredentials and plugin
#       refresh both land on EFS even if we somehow skipped the seed block).
#
# Skipped entirely for local docker-compose: env var is unset AND the EFS
# file doesn't exist, so the bind-mount's regular file at $CANONICAL stays
# untouched.  Once the user uploads via the UI in a containerised dev,
# subsequent boots will find $EFS_CREDS and start symlinking.
if [ -n "${CLAUDE_CREDENTIALS_JSON:-}" ] || [ -e "$EFS_CREDS" ]; then
  # Force-relink: tolerates a stale symlink from a prior boot or a regular
  # file left by an older entrypoint version.  Always idempotent.
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
