#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: script/update-local-opencode.sh [--execute]

Updates the local production OpenCode binary from this fork stack:
  1. fetch upstream and fork remotes
  2. rebase the base patch branch onto upstream dev
  3. rebase the feature branch onto the base patch branch
  4. install dependencies and build the current-platform binary
  5. back up OpenCode session data before stopping the stack
  6. stop the stack, make a final session backup, replace the binary, start the stack

Default mode is dry-run. Pass --execute to stop/start prod and replace the binary.

Environment overrides:
  REPO_DIR            default: /var/opt/opencode-upstream
  UPSTREAM_REMOTE     default: origin
  UPSTREAM_BRANCH     default: dev
  FORK_REMOTE         default: fork
  BASE_PATCH_BRANCH   default: tool-timestamp-metadata
  FEATURE_BRANCH      default: jump-user-message
  STACK_SCRIPT        default: /var/opt/opencode-telegram-group-topics-bot/opencode-stack.sh
  TARGET_BIN          default: /root/.opencode/bin/opencode
  SESSION_DIR         default: /root/.local/share/opencode
  BACKUP_ROOT         default: /root/.local/share/opencode/backups
  ALLOW_DIRTY         default: 0; set 1 to allow tracked worktree changes
EOF
}

EXECUTE=0
case "${1:-}" in
  "") ;;
  --execute) EXECUTE=1 ;;
  -h|--help|help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

REPO_DIR="${REPO_DIR:-/var/opt/opencode-upstream}"
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-origin}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-dev}"
FORK_REMOTE="${FORK_REMOTE:-fork}"
BASE_PATCH_BRANCH="${BASE_PATCH_BRANCH:-tool-timestamp-metadata}"
FEATURE_BRANCH="${FEATURE_BRANCH:-jump-user-message}"
STACK_SCRIPT="${STACK_SCRIPT:-/var/opt/opencode-telegram-group-topics-bot/opencode-stack.sh}"
TARGET_BIN="${TARGET_BIN:-/root/.opencode/bin/opencode}"
SESSION_DIR="${SESSION_DIR:-/root/.local/share/opencode}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/.local/share/opencode/backups}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"

timestamp() {
  date -u +%Y%m%dT%H%M%SZ
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

run() {
  log "+ $*"
  if (( EXECUTE == 1 )); then
    "$@"
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing command: $1"
    exit 1
  }
}

require_path() {
  [[ -e "$1" ]] || {
    log "missing path: $1"
    exit 1
  }
}

git_run() {
  run env GIT_MASTER=1 git "$@"
}

git_capture() {
  env GIT_MASTER=1 git "$@"
}

require_clean_tracked_tree() {
  if [[ "$ALLOW_DIRTY" == "1" ]]; then
    log "ALLOW_DIRTY=1 set; tracked worktree cleanliness check skipped"
    return 0
  fi

  local status
  status="$(git_capture status --porcelain --untracked-files=no)"
  [[ -z "$status" ]] || {
    log "tracked worktree has changes; commit/stash them or set ALLOW_DIRTY=1"
    printf '%s\n' "$status"
    exit 1
  }
}

backup_sessions() {
  local label="$1"
  local backup_file="$BACKUP_ROOT/opencode-sessions-$label-$(timestamp).tar.gz"

  require_path "$SESSION_DIR"
  run mkdir -p "$BACKUP_ROOT"
  log "session backup target: $backup_file"
  if (( EXECUTE == 1 )); then
    tar --warning=no-file-changed --ignore-failed-read -C "$(dirname "$SESSION_DIR")" -czf "$backup_file" "$(basename "$SESSION_DIR")"
  fi
}

wait_for_port() {
  local port="$1"
  for _ in {1..180}; do
    if ss -ltn | grep -qE "(^|:)${port}[[:space:]]"; then
      log "port $port is listening"
      return 0
    fi
    sleep 1
  done
  log "port $port did not open in time"
  return 1
}

main() {
  require_cmd bash
  require_cmd bun
  require_cmd git
  require_cmd ss
  require_cmd tar
  require_path "$REPO_DIR/.git"
  require_path "$STACK_SCRIPT"

  cd "$REPO_DIR"

  if (( EXECUTE == 0 )); then
    log "dry-run mode; pass --execute to perform changes"
  fi

  require_clean_tracked_tree

  git_run fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"
  git_run fetch "$FORK_REMOTE" "$BASE_PATCH_BRANCH" "$FEATURE_BRANCH"
  git_run checkout "$BASE_PATCH_BRANCH"
  git_run rebase "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  git_run checkout "$FEATURE_BRANCH"
  git_run rebase "$BASE_PATCH_BRANCH"

  run bun install
  run bun run --cwd packages/opencode build --single

  local built_bin="$REPO_DIR/packages/opencode/dist/opencode-linux-x64/bin/opencode"
  if (( EXECUTE == 1 )); then
    require_path "$built_bin"
    "$built_bin" --version
  else
    log "would verify built binary: $built_bin --version"
  fi

  backup_sessions "pre-stop"

  run "$STACK_SCRIPT" stop
  backup_sessions "post-stop"

  local binary_backup="$TARGET_BIN.$(timestamp).bak"
  require_path "$(dirname "$TARGET_BIN")"
  if (( EXECUTE == 1 )); then
    [[ -x "$built_bin" ]] || {
      log "built binary is not executable: $built_bin"
      exit 1
    }
    if [[ -e "$TARGET_BIN" ]]; then
      cp -a "$TARGET_BIN" "$binary_backup"
      log "current binary backup: $binary_backup"
    fi
    install -m 755 "$built_bin" "$TARGET_BIN.new"
    mv -f "$TARGET_BIN.new" "$TARGET_BIN"
  else
    log "would back up current binary to: $binary_backup"
    log "would install built binary to: $TARGET_BIN"
  fi

  run "$STACK_SCRIPT" start
  if (( EXECUTE == 1 )); then
    wait_for_port 4416
    "$TARGET_BIN" --version
  else
    log "would wait for port 4416 and verify: $TARGET_BIN --version"
  fi
}

main "$@"
