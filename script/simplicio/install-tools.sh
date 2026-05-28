#!/usr/bin/env bash
# Install / update the Simplicio toolchain.
# Idempotent: safe to run repeatedly. Used by the daily cron and on first setup.

set -euo pipefail

log() { printf '\033[1;36m[simplicio]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[simplicio]\033[0m %s\n' "$*" >&2; }

# ----- Node.js side ----------------------------------------------------------
# simplicio-mapper is distributed as @wesleysimplicio/llm-project-mapper.
# We don't install it globally — `npx -y …@latest` always pulls the latest.
if command -v npx >/dev/null 2>&1; then
  log "warming npx cache for @wesleysimplicio/llm-project-mapper@latest"
  npx -y @wesleysimplicio/llm-project-mapper@latest --version >/dev/null 2>&1 || \
    warn "could not pre-warm mapper (network?); next invocation will fetch on demand"
else
  warn "npx not found; install Node.js to use simplicio-mapper"
fi

# ----- Python side -----------------------------------------------------------
PY="${PYTHON:-python3}"
if command -v "$PY" >/dev/null 2>&1; then
  log "installing/updating simplicio-cli simplicio-sprint simplicio-prompt"
  "$PY" -m pip install --upgrade \
    simplicio-cli \
    simplicio-sprint \
    simplicio-prompt \
    || warn "pip install failed; retry online"
else
  warn "python3 not found; install Python 3.10+ to use simplicio-cli/sprint"
fi

# ----- Local AI: Simplicio1 (Qwen 2.5 Coder 3B via Ollama) -------------------
if command -v ollama >/dev/null 2>&1; then
  log "pulling qwen2.5-coder:3b (Simplicio1) via ollama"
  ollama pull qwen2.5-coder:3b || warn "ollama pull failed; will retry on next run"
else
  warn "ollama not found — Simplicio1 (Qwen 2.5 Coder 3B) requires ollama"
  warn "install: https://ollama.com/download"
fi

log "done"
