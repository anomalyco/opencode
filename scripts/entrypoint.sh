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

if [ -n "${CLAUDE_CREDENTIALS_JSON:-}" ]; then
  mkdir -p /root/.claude
  printf '%s' "$CLAUDE_CREDENTIALS_JSON" > /root/.claude/.credentials.json
  chmod 0600 /root/.claude/.credentials.json
fi

# Hand off to the real server.  $@ propagates whatever args ECS / CMD passed.
exec bun run --cwd packages/opencode src/index.ts serve \
  --port 4096 --hostname 0.0.0.0 --print-logs "$@"
