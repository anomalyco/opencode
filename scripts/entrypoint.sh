#!/bin/sh
# Container entrypoint for the collab fork.
#
# On Fargate we can't bind-mount ~/.claude/.credentials.json from a host,
# so we ship the credential JSON via Secrets Manager and write it to disk on
# every container start.  The opencode-claude-auth plugin then reads the file
# at runtime and treats it as if it were the local Mac credential file.
#
# Idempotent: no-op when CLAUDE_CREDENTIALS_JSON is unset (preserves local
# docker-compose flow that bind-mounts the file instead).
#
# Operator rotation: when Claude credentials rotate (every few weeks),
# re-dump on a developer Mac with
#   security find-generic-password -s "Claude Code-credentials" -w
# and update the Secrets Manager entry collab/<stage>/claude_credentials.
# The next ECS task replacement picks up the new value.

set -eu

# Resolve the home dir from $HOME (set by the Dockerfile to /home/opencode
# under ADR-0003).  Falls back to /home/opencode if unset, which is the
# only correct path post-ADR.  /root/... would mean we're still root —
# entrypoint logs would show a chown error and the credential write would
# 500 the auth plugin until ECS replaces the task.
HOME_DIR="${HOME:-/home/opencode}"

if [ -n "${CLAUDE_CREDENTIALS_JSON:-}" ]; then
  mkdir -p "$HOME_DIR/.claude"
  printf '%s' "$CLAUDE_CREDENTIALS_JSON" > "$HOME_DIR/.claude/.credentials.json"
  chmod 0600 "$HOME_DIR/.claude/.credentials.json"
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
