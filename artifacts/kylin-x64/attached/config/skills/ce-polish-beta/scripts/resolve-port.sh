#!/usr/bin/env bash
#
# resolve-port.sh -- resolve the dev-server port for a project.
#
# Usage:
#   resolve-port.sh [path] [--type <type>] [--port <n>]
#
# Arguments:
#   path   (optional) -- project root directory. Defaults to the git repo root.
#   --type (optional) -- framework type to scope probes (rails|next|vite|nuxt|
#                        astro|remix|sveltekit|procfile). Unset runs all probes.
#   --port (optional) -- explicit port override. Emitted immediately when present.
#
# Output:
#   Single line on stdout: the resolved port number.
#   stderr is reserved for ERROR: messages only.
#
# Probe order (FIRST HIT WINS):
#
#   1. Explicit --port flag
#   2. Framework config files (next.config.*, vite.config.*, nuxt.config.*,
#      astro.config.*) -- conservative regex matching only numeric literal
#      port values. Variable references like process.env.PORT or getPort()
#      are deliberately not matched; the probe falls through.
#   3. Rails: config/puma.rb for `port <n>`
#   4. Procfile.dev: web line scanned for -p/-p=<n>/--port/--port=<n>
#   5. docker-compose.yml: line-anchored grep for "- "<n>:<n>"" port mapping
#   6. package.json: dev/start script for --port/-p flags
#   7. .env files in override order: .env.local -> .env.development -> .env
#      (first hit wins). Values are parsed with quote stripping (" and ')
#      and comment truncation (at #, after trimming whitespace).
#   8. Framework default lookup table
#
# Why config-before-prose: framework config files are the most reliable source
# of truth for the intended port; instruction files and env files are often
# stale or overridden. Prose files (AGENTS.md, CLAUDE.md) are deliberately NOT
# scanned -- they carry natural language that may mention ports in contexts
# unrelated to the dev server (documentation, examples, troubleshooting).
# Scanning them produces false positives that are hard to debug.
#
# .env parsing contract: surrounding double or single quotes are stripped.
# Inline comments (# ...) are truncated after trimming whitespace. This is
# intentionally more aggressive than the test-browser skill's inline cascade,
# which does neither. See dev-server-detection.md for the divergence notes.

set -u

# ── Argument parsing ─────────────────────────────────────────────────────────

PROJECT_ROOT=""
PROJ_TYPE=""
EXPLICIT_PORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --type)
      PROJ_TYPE="${2:-}"
      shift 2
      ;;
    --port)
      EXPLICIT_PORT="${2:-}"
      shift 2
      ;;
    *)
      if [ -z "$PROJECT_ROOT" ]; then
        PROJECT_ROOT="$1"
      fi
      shift
      ;;
  esac
done

# Default to git repo root when no positional path is given.
if [ -z "$PROJECT_ROOT" ]; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$PROJECT_ROOT" ]; then
    echo "ERROR: not in a git repository and no path provided" >&2
    exit 1
  fi
fi

if [ ! -d "$PROJECT_ROOT" ]; then
  echo "ERROR: path does not exist: $PROJECT_ROOT" >&2
  exit 1
fi

# ── Helpers ──────────────────────────────────────────────────────────────────

# should_probe TYPE PROBE_NAME
# Returns 0 (true) if the probe should run for the given --type.
should_probe() {
  local ptype="$1"
  local probe="$2"

  if [ -z "$ptype" ]; then
    return 0  # no type filter -- run all probes
  fi

  case "$ptype" in
    rails)
      case "$probe" in
        puma|procfile|docker-compose|env|default) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    next|nuxt|astro|remix|vite|sveltekit)
      case "$probe" in
        framework-config|package-json|env|default) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    procfile)
      case "$probe" in
        procfile|docker-compose|env|default) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    *)
      return 0  # unknown type -- run all probes
      ;;
  esac
}

# parse_env_port FILE
# Parses PORT=<n> from the given file. Strips surrounding quotes and inline
# comments. Prints the port on stdout or nothing.
parse_env_port() {
  local envfile="$1"
  if [ ! -f "$envfile" ]; then
    return
  fi

  local line
  line=$(grep -E '^PORT=' "$envfile" 2>/dev/null | tail -1)
  if [ -z "$line" ]; then
    return
  fi

  # Extract value after PORT=
  local value
  value="${line#PORT=}"

  # Trim whitespace, then truncate at # (inline comment) -- comment stripping
  # must happen BEFORE quote stripping so PORT="3001" # comment -> "3001" -> 3001
  value=$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*#.*$//;s/[[:space:]]*$//')

  # Strip surrounding double quotes
  value="${value%\"}"
  value="${value#\"}"

  # Strip surrounding single quotes
  value="${value%\'}"
  value="${value#\'}"

  # Trim any remaining whitespace
  value=$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

  if [ -n "$value" ]; then
    printf '%s' "$value"
  fi
}

# ── Probe 1: Explicit --port flag ────────────────────────────────────────────

if [ -n "$EXPLICIT_PORT" ]; then
  echo "$EXPLICIT_PORT"
  exit 0
fi

# ── Probe 2: Framework config files ─────────────────────────────────────────

if should_probe "$PROJ_TYPE" "framework-config"; then
  for cfg in \
    "$PROJECT_ROOT"/next.config.js \
    "$PROJECT_ROOT"/next.config.ts \
    "$PROJECT_ROOT"/next.config.mjs \
    "$PROJECT_ROOT"/next.config.cjs \
    "$PROJECT_ROOT"/vite.config.js \
    "$PROJECT_ROOT"/vite.config.ts \
    "$PROJECT_ROOT"/vite.config.mjs \
    "$PROJECT_ROOT"/vite.config.cjs \
    "$PROJECT_ROOT"/nuxt.config.js \
    "$PROJECT_ROOT"/nuxt.config.ts \
    "$PROJECT_ROOT"/nuxt.config.mjs \
    "$PROJECT_ROOT"/nuxt.config.cjs \
    "$PROJECT_ROOT"/astro.config.js \
    "$PROJECT_ROOT"/astro.config.ts \
    "$PROJECT_ROOT"/astro.config.mjs \
    "$PROJECT_ROOT"/astro.config.cjs \
  ; do
    if [ ! -f "$cfg" ]; then
      continue
    fi

    # Conservative regex: match "port:" + digits, then verify nothing non-numeric
    # follows (rejects variable references like "port: process.env.PORT || 3000").
    local_line=$(grep -E 'port:[[:space:]]*["'"'"']?[0-9]+' "$cfg" 2>/dev/null | head -1)
    if [ -z "$local_line" ]; then continue; fi

    local_port=$(printf '%s' "$local_line" | grep -Eo 'port:[[:space:]]*["'"'"']?[0-9]+["'"'"']?' | head -1 | grep -Eo '[0-9]+')
    if [ -n "$local_port" ]; then
      local_after=$(printf '%s' "$local_line" | sed "s/.*port:[[:space:]]*[\"']*${local_port}[\"']*//" )
      if [ -z "$local_after" ] || printf '%s' "$local_after" | grep -qE '^[[:space:],})]*$'; then
        echo "$local_port"
        exit 0
      fi
    fi
  done
fi

# ── Probe 3: Rails config/puma.rb ───────────────────────────────────────────

if should_probe "$PROJ_TYPE" "puma"; then
  puma_file="$PROJECT_ROOT/config/puma.rb"
  if [ -f "$puma_file" ]; then
    puma_port=$(grep -Eo 'port[[:space:]]+[0-9]+' "$puma_file" 2>/dev/null | head -1 | grep -Eo '[0-9]+')
    if [ -n "$puma_port" ]; then
      echo "$puma_port"
      exit 0
    fi
  fi
fi

# ── Probe 4: Procfile.dev ───────────────────────────────────────────────────

if should_probe "$PROJ_TYPE" "procfile"; then
  procfile="$PROJECT_ROOT/Procfile.dev"
  if [ -f "$procfile" ]; then
    # Extract the web line
    web_line=$(grep -E '^web:' "$procfile" 2>/dev/null | head -1)
    if [ -n "$web_line" ]; then
      # Match -p <n>, -p<n>, --port <n>, -p=<n>, --port=<n>
      proc_port=$(printf '%s' "$web_line" | grep -Eo '(-p[= ]*|--port[= ]+)[0-9]+' | head -1 | grep -Eo '[0-9]+')
      if [ -n "$proc_port" ]; then
        echo "$proc_port"
        exit 0
      fi
    fi
  fi
fi

# ── Probe 5: docker-compose.yml ─────────────────────────────────────────────

if should_probe "$PROJ_TYPE" "docker-compose"; then
  compose_file="$PROJECT_ROOT/docker-compose.yml"
  if [ -f "$compose_file" ]; then
    # Simple line-anchored grep for port mappings: - "NNNN:NNNN" or - NNNN:NNNN
    compose_port=$(grep -Eo '"[0-9]+:[0-9]+"' "$compose_file" 2>/dev/null | head -1 | grep -Eo '[0-9]+' | head -1)
    if [ -n "$compose_port" ]; then
      echo "$compose_port"
      exit 0
    fi
  fi
fi

# ── Probe 6: package.json scripts ───────────────────────────────────────────

if should_probe "$PROJ_TYPE" "package-json"; then
  pkg_file="$PROJECT_ROOT/package.json"
  if [ -f "$pkg_file" ]; then
    # Look for --port or -p in dev/start scripts
    pkg_port=$(grep -Eo '(-p[= ]+|--port[= ]+)[0-9]+' "$pkg_file" 2>/dev/null | head -1 | grep -Eo '[0-9]+')
    if [ -n "$pkg_port" ]; then
      echo "$pkg_port"
      exit 0
    fi
  fi
fi

# ── Probe 7: .env files ─────────────────────────────────────────────────────

if should_probe "$PROJ_TYPE" "env"; then
  for envfile in \
    "$PROJECT_ROOT/.env.local" \
    "$PROJECT_ROOT/.env.development" \
    "$PROJECT_ROOT/.env" \
  ; do
    env_port=$(parse_env_port "$envfile")
    if [ -n "$env_port" ]; then
      echo "$env_port"
      exit 0
    fi
  done
fi

# ── Probe 8: Framework default lookup table ──────────────────────────────────

if should_probe "$PROJ_TYPE" "default"; then
  case "$PROJ_TYPE" in
    rails|next|nuxt|remix|procfile|"")
      echo "3000"
      ;;
    vite|sveltekit)
      echo "5173"
      ;;
    astro)
      echo "4321"
      ;;
    *)
      echo "3000"
      ;;
  esac
  exit 0
fi

# Final fallback (should not normally be reached)
echo "3000"
exit 0
