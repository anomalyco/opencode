#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: script/update-local-opencode.sh [--execute]

Updates the local production OpenCode binary from this fork stack:
  1. clone the source checkout if REPO_DIR does not exist yet
  2. fetch upstream and fork remotes
  3. rebase the base patch branch onto upstream dev
  4. rebase the feature branch onto the base patch branch
  5. install dependencies and build the current-platform binary
  6. back up OpenCode session data before stopping the stack
  7. stop the stack, make a final session backup, replace the binary, start the stack

Default mode is dry-run. Pass --execute to stop/start prod and replace the binary.
If REPO_DIR exists but is not a git checkout, --execute moves it aside to
REPO_DIR.bootstrap-backup.<timestamp> before cloning a fresh checkout.

Environment overrides:
  ENV_FILE            default: .env next to this script; sourced when present
  REPO_DIR            default: /var/opt/opencode-upstream
  UPSTREAM_URL         default: https://github.com/sst/opencode.git
  FORK_URL             default: https://github.com/CryptoAlchemik/opencode.git
  UPSTREAM_REMOTE     default: origin
  UPSTREAM_BRANCH     default: dev
  FORK_REMOTE         default: fork
  BASE_PATCH_BRANCH   default: tool-timestamp-metadata
  FEATURE_BRANCH      default: jump-user-message
  STACK_SCRIPT        default: /var/opt/opencode-telegram-group-topics-bot/opencode-stack.sh
  TARGET_BIN          default: /root/.opencode/bin/opencode
  HEALTH_URL          default: http://127.0.0.1:4416/global/health
  OPENCODE_SERVER_PASSWORD used for authenticated health checks when set;
                           prompts in interactive sessions when unset
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"

load_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

load_env_file

REPO_DIR="${REPO_DIR:-/var/opt/opencode-upstream}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/sst/opencode.git}"
FORK_URL="${FORK_URL:-https://github.com/CryptoAlchemik/opencode.git}"
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-origin}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-dev}"
FORK_REMOTE="${FORK_REMOTE:-fork}"
BASE_PATCH_BRANCH="${BASE_PATCH_BRANCH:-tool-timestamp-metadata}"
FEATURE_BRANCH="${FEATURE_BRANCH:-jump-user-message}"
STACK_SCRIPT="${STACK_SCRIPT:-/var/opt/opencode-telegram-group-topics-bot/opencode-stack.sh}"
TARGET_BIN="${TARGET_BIN:-/root/.opencode/bin/opencode}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4416/global/health}"
SESSION_DIR="${SESSION_DIR:-/root/.local/share/opencode}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/.local/share/opencode/backups}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"

timestamp() {
  date -u +%Y%m%dT%H%M%SZ
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

if [[ -f "$ENV_FILE" ]]; then
  log "loaded env file: $ENV_FILE"
fi

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

ensure_repo() {
  if [[ -d "$REPO_DIR/.git" ]]; then
    log "using existing checkout: $REPO_DIR"
    return 0
  fi

  if [[ -e "$REPO_DIR" ]]; then
    local backup_dir="$REPO_DIR.bootstrap-backup.$(timestamp)"
    if (( EXECUTE == 1 )); then
      mv "$REPO_DIR" "$backup_dir"
      log "moved non-git REPO_DIR aside: $backup_dir"
    else
      log "+ mv $REPO_DIR $backup_dir"
      log "dry-run bootstrap stops here because REPO_DIR exists but is not a git checkout"
      exit 0
    fi
  fi

  local parent
  parent="$(dirname "$REPO_DIR")"
  if (( EXECUTE == 1 )); then
    mkdir -p "$parent"
    env GIT_MASTER=1 git clone --origin "$UPSTREAM_REMOTE" --branch "$UPSTREAM_BRANCH" "$UPSTREAM_URL" "$REPO_DIR"
  else
    log "+ mkdir -p $parent"
    log "+ env GIT_MASTER=1 git clone --origin $UPSTREAM_REMOTE --branch $UPSTREAM_BRANCH $UPSTREAM_URL $REPO_DIR"
    log "dry-run bootstrap stops here because REPO_DIR does not exist yet"
    exit 0
  fi
}

ensure_remote() {
  local name="$1"
  local url="$2"

  if git_capture remote get-url "$name" >/dev/null 2>&1; then
    git_run remote set-url "$name" "$url"
    return 0
  fi

  git_run remote add "$name" "$url"
}

checkout_branch_from_remote() {
  local branch="$1"
  local remote="$2"

  if git_capture show-ref --verify --quiet "refs/heads/$branch"; then
    git_run checkout "$branch"
    return 0
  fi

  git_run checkout -b "$branch" "$remote/$branch"
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

load_health_password() {
  if [[ -n "${OPENCODE_SERVER_PASSWORD:-}" ]]; then
    log "using OPENCODE_SERVER_PASSWORD from environment"
    return 0
  fi

  if [[ -t 0 ]]; then
    local password=""
    printf 'OPENCODE_SERVER_PASSWORD is unset; enter password for authenticated health checks, or leave blank to skip auth: '
    read -rs password || password=""
    printf '\n'

    if [[ -n "$password" ]]; then
      export OPENCODE_SERVER_PASSWORD="$password"
      log "using OPENCODE_SERVER_PASSWORD from interactive prompt"
      return 0
    fi

    log "no health-check password entered; health check will run without auth"
    return 0
  fi

  log "OPENCODE_SERVER_PASSWORD is not set and session is non-interactive; health check will run without auth"
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

verify_binary() {
  local binary="$1"
  [[ -f "$binary" && -x "$binary" && ! -L "$binary" ]] || {
    log "binary is missing, not executable, or is a symlink: $binary"
    return 1
  }

  "$binary" --version >/dev/null
}

verify_stack_health() {
  wait_for_port 4416 || return 1
  verify_binary "$TARGET_BIN" || return 1
  if [[ -n "${OPENCODE_SERVER_PASSWORD:-}" ]]; then
    curl -fsS --max-time 5 -u "opencode:${OPENCODE_SERVER_PASSWORD}" "$HEALTH_URL" >/dev/null
    return $?
  fi
  curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null
}

backup_binary() {
  local source="$1" destination="$2"

  [[ -f "$source" && -x "$source" && ! -L "$source" ]] || {
    log "cannot create rollback backup; target binary is missing, not executable, or is a symlink: $source"
    return 1
  }
  [[ ! -e "$destination" ]] || {
    log "refusing to overwrite existing binary backup: $destination"
    return 1
  }

  cp -a "$source" "$destination"
  [[ -f "$destination" && -x "$destination" ]] || {
    log "binary backup validation failed: $destination"
    return 1
  }
  log "current binary backup: $destination"
}

install_binary() {
  local source="$1" destination="$2"

  install -m 755 "$source" "$destination.new"
  mv -f "$destination.new" "$destination"
}

rollback_binary() {
  local binary_backup="$1"

  log "rolling back $TARGET_BIN from $binary_backup"
  [[ -f "$binary_backup" && -x "$binary_backup" ]] || {
    log "rollback backup is unavailable or invalid: $binary_backup"
    return 1
  }

  "$STACK_SCRIPT" stop || true
  install_binary "$binary_backup" "$TARGET_BIN"
  "$STACK_SCRIPT" start
  verify_stack_health
  log "rollback completed; backup retained: $binary_backup"
}

confirm_backup_removal() {
  local binary_backup="$1" answer=""

  if [[ ! -t 0 ]]; then
    log "non-interactive session; retaining rollback backup: $binary_backup"
    return 0
  fi

  printf 'Confirm production was manually checked and remove rollback backup %s? [y/N] ' "$binary_backup"
  read -r answer || answer=""
  case "${answer,,}" in
    y|yes)
      rm -f -- "$binary_backup"
      log "removed confirmed binary backup: $binary_backup"
      ;;
    *)
      log "retaining rollback backup: $binary_backup"
      ;;
  esac
}

main() {
  require_cmd bash
  require_cmd bun
  require_cmd curl
  require_cmd git
  require_cmd ss
  require_cmd tar
  require_path "$STACK_SCRIPT"

  ensure_repo
  cd "$REPO_DIR"

  if (( EXECUTE == 0 )); then
    log "dry-run mode; pass --execute to perform changes"
  fi

  load_health_password

  require_clean_tracked_tree

  ensure_remote "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
  ensure_remote "$FORK_REMOTE" "$FORK_URL"
  git_run fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"
  git_run fetch "$FORK_REMOTE" "$BASE_PATCH_BRANCH" "$FEATURE_BRANCH"
  checkout_branch_from_remote "$BASE_PATCH_BRANCH" "$FORK_REMOTE"
  git_run rebase "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  checkout_branch_from_remote "$FEATURE_BRANCH" "$FORK_REMOTE"
  git_run rebase "$BASE_PATCH_BRANCH"

  run bun install
  run bun run --cwd packages/opencode build --single

  local built_bin="$REPO_DIR/packages/opencode/dist/opencode-linux-x64/bin/opencode"
  if (( EXECUTE == 1 )); then
    require_path "$built_bin"
    verify_binary "$built_bin"
  else
    log "would verify built binary: $built_bin --version"
  fi

  backup_sessions "pre-stop"

  local binary_backup="$TARGET_BIN.$(timestamp).bak"
  require_path "$(dirname "$TARGET_BIN")"
  if (( EXECUTE == 1 )); then
    backup_binary "$TARGET_BIN" "$binary_backup"

    "$STACK_SCRIPT" stop
    if ! backup_sessions "post-stop"; then
      log "post-stop session backup failed; restarting old binary"
      "$STACK_SCRIPT" start || true
      exit 1
    fi

    if ! install_binary "$built_bin" "$TARGET_BIN"; then
      log "new binary install failed"
      rollback_binary "$binary_backup" || log "rollback failed; backup retained: $binary_backup"
      exit 1
    fi

    if ! "$STACK_SCRIPT" start; then
      log "new binary failed during stack start"
      rollback_binary "$binary_backup" || log "rollback failed; backup retained: $binary_backup"
      exit 1
    fi

    if ! verify_stack_health; then
      log "new binary failed health check"
      rollback_binary "$binary_backup" || log "rollback failed; backup retained: $binary_backup"
      exit 1
    fi

    log "new binary passed startup and health checks"
    confirm_backup_removal "$binary_backup"
  else
    log "would back up current binary to: $binary_backup"
    log "would stop stack with: $STACK_SCRIPT stop"
    log "would create post-stop session backup"
    log "would install built binary to: $TARGET_BIN"
    log "would start stack with: $STACK_SCRIPT start"
    log "would roll back from $binary_backup if stack start or health check fails"
    log "would retain rollback backup unless an interactive user confirms removal"
    log "would wait for port 4416, verify $TARGET_BIN --version, and check $HEALTH_URL"
  fi
}

main "$@"
