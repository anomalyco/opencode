#!/usr/bin/env bash
set -euo pipefail

state="${1:-}"
repo_root="${OPENCODE_SANDBOX_REPO_ROOT:-/home/choza/projects/opencode-source}"
evidence_dir="${OPENCODE_SANDBOX_EVIDENCE_DIR:-$repo_root/.sisyphus/evidence}"
opencode_dir="${OPENCODE_SANDBOX_OPENCODE_DIR:-$repo_root/packages/opencode}"
check_script="$repo_root/.sisyphus/evidence/check-sandbox-evidence.sh"
model="${OPENCODE_SANDBOX_MODEL:-openai/gpt-5.2-codex}"
if [[ -z "$state" ]]; then
  echo "Usage: $0 <error|final|stream|tool|warning|idle>"
  echo "Tip: view ANSI output with: less -R $evidence_dir/task-2-<state>.txt"
  echo "Tip: validate output with: $evidence_dir/check-sandbox-evidence.sh <state>"
  echo "Tip: set OPENCODE_SANDBOX_OPENAI_API_KEY for non-error states"
  echo "Tip: set OPENCODE_SANDBOX_MODEL to override the default model"
  exit 1
fi

if [[ -z "${OPENCODE_SANDBOX_OPENAI_API_KEY:-}" && -n "${OPENCODE_SANDBOX_OPENAI_API_KEY_CMD:-}" ]]; then
  OPENCODE_SANDBOX_OPENAI_API_KEY="$(bash -lc "$OPENCODE_SANDBOX_OPENAI_API_KEY_CMD")"
  export OPENCODE_SANDBOX_OPENAI_API_KEY
fi

export PATH="$HOME/.bun/bin:$PATH"

export OPENCODE_PERMISSION='{"*":"allow"}'
export OPENCODE_DISABLE_DEFAULT_PLUGINS=1
export OPENCODE_DISABLE_LSP_DOWNLOAD=1
export OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=1
export OPENCODE_DISABLE_MODELS_FETCH=1

if [[ -n "${OPENCODE_SANDBOX_ROOT:-}" ]]; then
  sandbox_root="$OPENCODE_SANDBOX_ROOT"
else
  sandbox_root="/tmp/opencode-sandbox-${state}-$(date +%s)"
fi
export XDG_DATA_HOME="$sandbox_root/data"
export XDG_CONFIG_HOME="$sandbox_root/config"
export XDG_STATE_HOME="$sandbox_root/state"
export XDG_CACHE_HOME="$sandbox_root/cache"
export OPENCODE_TEST_HOME="$sandbox_root/home"
export OPENCODE_DISABLE_PROJECT_CONFIG=1

mkdir -p "$XDG_CONFIG_HOME/opencode" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$OPENCODE_TEST_HOME"

config_path="$XDG_CONFIG_HOME/opencode/opencode.json"
auth_target_dir="$XDG_DATA_HOME/opencode"
auth_target="$auth_target_dir/auth.json"

if [[ "$state" != "error" ]]; then
  if [[ -n "${OPENCODE_SANDBOX_AUTH_SOURCE:-}" ]]; then
    mkdir -p "$auth_target_dir"
    cp "$OPENCODE_SANDBOX_AUTH_SOURCE" "$auth_target"
  elif [[ "${OPENCODE_SANDBOX_USE_REAL_AUTH:-}" == "1" ]]; then
    if [[ -f "$HOME/.local/share/opencode/auth.json" ]]; then
      mkdir -p "$auth_target_dir"
      cp "$HOME/.local/share/opencode/auth.json" "$auth_target"
    fi
  fi
fi

if [[ "$state" != "error" && -z "${OPENCODE_SANDBOX_OPENAI_API_KEY:-}" && ! -f "$auth_target" ]]; then
  echo "Provide OPENCODE_SANDBOX_OPENAI_API_KEY or copy auth.json into sandbox (OPENCODE_SANDBOX_USE_REAL_AUTH=1)"
  exit 1
fi
if [[ "$state" == "error" ]]; then
  cat > "$config_path" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "enabled_providers": ["openai"],
  "model": "${model}",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "invalid"
      }
    }
  }
}
EOF
else
  cat > "$config_path" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "enabled_providers": ["openai"],
  "model": "${model}",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{env:OPENCODE_SANDBOX_OPENAI_API_KEY}"
      }
    }
  }
}
EOF
fi

echo "Sandbox config: $config_path"
echo "State: $state"

if [[ -n "${OPENCODE_SANDBOX_SESSION_NAME:-}" ]]; then
  session_name="$OPENCODE_SANDBOX_SESSION_NAME"
else
  session_name="opencode-sandbox-${state}-$(date +%s)"
fi
evidence_dir="$evidence_dir"
evidence_file="$evidence_dir/task-2-${state}.txt"
idle_evidence_a="$evidence_dir/task-2-idle-a.txt"
idle_evidence_b="$evidence_dir/task-2-idle-b.txt"
skip_final_capture=0
log_file="$XDG_DATA_HOME/opencode/log/dev.log"
log_evidence="$evidence_dir/task-2-log.txt"

mkdir -p "$evidence_dir"

if tmux has-session -t "$session_name" 2>/dev/null; then
  tmux kill-session -t "$session_name"
fi

tmux new-session -d -s "$session_name" "bash"
tmux send-keys -t "$session_name" "export PATH=\"$HOME/.bun/bin:$PATH\"" Enter
tmux send-keys -t "$session_name" "export XDG_DATA_HOME=$XDG_DATA_HOME XDG_CONFIG_HOME=$XDG_CONFIG_HOME XDG_STATE_HOME=$XDG_STATE_HOME XDG_CACHE_HOME=$XDG_CACHE_HOME OPENCODE_TEST_HOME=$OPENCODE_TEST_HOME OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_PERMISSION='$OPENCODE_PERMISSION' OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_DISABLE_LSP_DOWNLOAD=1 OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=1 OPENCODE_DISABLE_MODELS_FETCH=1" Enter
tmux send-keys -t "$session_name" "cd $opencode_dir" Enter
tmux send-keys -t "$session_name" "bun run dev -- --model $model" Enter

prompt_ready=0
for _ in {1..12}; do
  sleep 1
  if tmux capture-pane -e -t "$session_name" -p | rg -q "Ask anything|Build"; then
    prompt_ready=1
    break
  fi
done

if [[ "$prompt_ready" != "1" ]]; then
  tmux capture-pane -e -t "$session_name" -p > "$evidence_file"
  tmux kill-session -t "$session_name"
  echo "TUI did not become ready within timeout. Evidence: $evidence_file"
  exit 1
fi

wait_for_pattern() {
  local pattern="$1"
  local retries="$2"
  local delay="$3"

  for _ in $(seq 1 "$retries"); do
    if tmux capture-pane -e -t "$session_name" -p | rg -q "$pattern"; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

strip_ansi() {
  sed -E 's/\x1b\[[0-9;]*[mK]//g'
}

wait_for_pattern_excluding_prompt() {
  local pattern="$1"
  local prompt_text="$2"
  local retries="$3"
  local delay="$4"

  for _ in $(seq 1 "$retries"); do
    if tmux capture-pane -e -t "$session_name" -p | strip_ansi | rg -vF "$prompt_text" | rg -q "$pattern"; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

case "$state" in
  idle)
    sleep 1
    tmux capture-pane -e -t "$session_name" -p > "$idle_evidence_a"
    sleep 1
    tmux capture-pane -e -t "$session_name" -p > "$idle_evidence_b"
    sleep 1
    tmux capture-pane -e -t "$session_name" -p > "$evidence_dir/task-2-idle-c.txt"
    evidence_file="$idle_evidence_a"
    skip_final_capture=1
    ;;
  stream)
    prompt_text="Write a long paragraph about ocean weather."
    tmux send-keys -t "$session_name" "$prompt_text"
    tmux send-keys -t "$session_name" C-m
    wait_for_pattern_excluding_prompt "ocean|weather" "$prompt_text" 12 1 || true
    ;;
  tool)
    prompt_text="Run \`echo ok\`"
    tmux send-keys -t "$session_name" "$prompt_text"
    tmux send-keys -t "$session_name" C-m
    wait_for_pattern_excluding_prompt "\bok\b|Handling injected command request" "$prompt_text" 12 1 || true
    ;;
  warning)
    prompt_text="Run \`ls /does-not-exist\`"
    tmux send-keys -t "$session_name" "$prompt_text"
    tmux send-keys -t "$session_name" C-m
    wait_for_pattern_excluding_prompt "No such file or directory|cannot access" "$prompt_text" 12 1 || true
    ;;
  final)
    prompt_text="Say 'ready'"
    tmux send-keys -t "$session_name" "$prompt_text"
    tmux send-keys -t "$session_name" C-m
    wait_for_pattern_excluding_prompt "ready" "$prompt_text" 12 1 || true
    ;;
  error)
    prompt_text="Say 'ready'"
    tmux send-keys -t "$session_name" "$prompt_text"
    tmux send-keys -t "$session_name" C-m
    wait_for_pattern_excluding_prompt "Incorrect API key provided:" "$prompt_text" 12 1 || true
    ;;
  *)
    echo "Unknown state: $state"
    tmux kill-session -t "$session_name"
    exit 1
    ;;
esac

if [[ "$skip_final_capture" != "1" ]]; then
  tmux capture-pane -e -t "$session_name" -p > "$evidence_file"
fi
tmux kill-session -t "$session_name"

if [[ -f "$log_file" ]]; then
  cp "$log_file" "$log_evidence"
else
  echo "Log not found: $log_file" > "$log_evidence"
fi

if [[ -f "$check_script" ]]; then
  OPENCODE_SANDBOX_EVIDENCE_DIR="$evidence_dir" OPENCODE_SANDBOX_REPO_ROOT="$repo_root" \
    OPENCODE_SANDBOX_MODEL="$model" \
    bash "$check_script" "$state" "$evidence_file"
fi

echo "Captured ANSI evidence: $evidence_file"
