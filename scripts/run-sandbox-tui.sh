#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [options] <error|final|stream|tool|warning|idle>"
  echo ""
  echo "Options:"
  echo "  --repo-root PATH"
  echo "  --evidence-dir PATH"
  echo "  --opencode-dir PATH"
  echo "  --model NAME"
  echo "  --width COLS"
  echo "  --height ROWS"
  echo "  --openai-api-key KEY"
  echo "  --openai-api-key-cmd CMD"
  echo "  --auth-source PATH"
  echo "  --use-real-auth"
  echo "  --theme NAME"
  echo "  --prompt-plugin NAME"
  echo "  --prompt-enabled VALUE"
  echo "  --expect-idle-cycle[=VALUE]"
  echo "  --root PATH"
  echo "  --session-name NAME"
  echo "  -h, --help"
  echo ""
  echo "Env vars are deprecated (OPENCODE_SANDBOX_*). Prefer flags above."
}

warn_env() {
  echo "Deprecated: $1 is set. Use $2 instead." >&2
}

state=""
repo_root=""
evidence_dir=""
opencode_dir=""
model=""
pane_width=""
pane_height=""
openai_api_key=""
openai_api_key_cmd=""
auth_source=""
use_real_auth=""
theme=""
prompt_plugin=""
prompt_enabled=""
expect_cycle=""
sandbox_root=""
session_name=""

repo_root_arg=0
evidence_dir_arg=0
opencode_dir_arg=0
model_arg=0
pane_width_arg=0
pane_height_arg=0
openai_api_key_arg=0
openai_api_key_cmd_arg=0
auth_source_arg=0
use_real_auth_arg=0
theme_arg=0
prompt_plugin_arg=0
prompt_enabled_arg=0
expect_cycle_arg=0
sandbox_root_arg=0
session_name_arg=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --repo-root)
      repo_root="$2"
      repo_root_arg=1
      shift 2
      ;;
    --repo-root=*)
      repo_root="${1#*=}"
      repo_root_arg=1
      shift
      ;;
    --evidence-dir)
      evidence_dir="$2"
      evidence_dir_arg=1
      shift 2
      ;;
    --evidence-dir=*)
      evidence_dir="${1#*=}"
      evidence_dir_arg=1
      shift
      ;;
    --opencode-dir)
      opencode_dir="$2"
      opencode_dir_arg=1
      shift 2
      ;;
    --opencode-dir=*)
      opencode_dir="${1#*=}"
      opencode_dir_arg=1
      shift
      ;;
    --model)
      model="$2"
      model_arg=1
      shift 2
      ;;
    --model=*)
      model="${1#*=}"
      model_arg=1
      shift
      ;;
    --width)
      pane_width="$2"
      pane_width_arg=1
      shift 2
      ;;
    --width=*)
      pane_width="${1#*=}"
      pane_width_arg=1
      shift
      ;;
    --height)
      pane_height="$2"
      pane_height_arg=1
      shift 2
      ;;
    --height=*)
      pane_height="${1#*=}"
      pane_height_arg=1
      shift
      ;;
    --openai-api-key)
      openai_api_key="$2"
      openai_api_key_arg=1
      shift 2
      ;;
    --openai-api-key=*)
      openai_api_key="${1#*=}"
      openai_api_key_arg=1
      shift
      ;;
    --openai-api-key-cmd)
      openai_api_key_cmd="$2"
      openai_api_key_cmd_arg=1
      shift 2
      ;;
    --openai-api-key-cmd=*)
      openai_api_key_cmd="${1#*=}"
      openai_api_key_cmd_arg=1
      shift
      ;;
    --auth-source)
      auth_source="$2"
      auth_source_arg=1
      shift 2
      ;;
    --auth-source=*)
      auth_source="${1#*=}"
      auth_source_arg=1
      shift
      ;;
    --use-real-auth)
      use_real_auth="1"
      use_real_auth_arg=1
      shift
      ;;
    --theme)
      theme="$2"
      theme_arg=1
      shift 2
      ;;
    --theme=*)
      theme="${1#*=}"
      theme_arg=1
      shift
      ;;
    --prompt-plugin)
      prompt_plugin="$2"
      prompt_plugin_arg=1
      shift 2
      ;;
    --prompt-plugin=*)
      prompt_plugin="${1#*=}"
      prompt_plugin_arg=1
      shift
      ;;
    --prompt-enabled)
      prompt_enabled="$2"
      prompt_enabled_arg=1
      shift 2
      ;;
    --prompt-enabled=*)
      prompt_enabled="${1#*=}"
      prompt_enabled_arg=1
      shift
      ;;
    --expect-idle-cycle)
      expect_cycle="1"
      expect_cycle_arg=1
      shift
      ;;
    --expect-idle-cycle=*)
      expect_cycle="${1#*=}"
      expect_cycle_arg=1
      shift
      ;;
    --root)
      sandbox_root="$2"
      sandbox_root_arg=1
      shift 2
      ;;
    --root=*)
      sandbox_root="${1#*=}"
      sandbox_root_arg=1
      shift
      ;;
    --session-name)
      session_name="$2"
      session_name_arg=1
      shift 2
      ;;
    --session-name=*)
      session_name="${1#*=}"
      session_name_arg=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -* )
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -n "$state" ]]; then
        echo "Unexpected argument: $1" >&2
        usage
        exit 1
      fi
      state="$1"
      shift
      ;;
  esac
done

if [[ -z "$state" ]]; then
  usage
  exit 1
fi

repo_root="${repo_root:-${OPENCODE_SANDBOX_REPO_ROOT:-/home/choza/projects/opencode-source}}"
evidence_dir="${evidence_dir:-${OPENCODE_SANDBOX_EVIDENCE_DIR:-$repo_root/.sisyphus/evidence}}"
opencode_dir="${opencode_dir:-${OPENCODE_SANDBOX_OPENCODE_DIR:-$repo_root/packages/opencode}}"
check_script="$repo_root/scripts/check-sandbox-evidence.sh"
model="${model:-${OPENCODE_SANDBOX_MODEL:-openai/gpt-5.2-codex}}"
pane_width="${pane_width:-${OPENCODE_SANDBOX_WIDTH:-80}}"
pane_height="${pane_height:-${OPENCODE_SANDBOX_HEIGHT:-24}}"
openai_api_key="${openai_api_key:-${OPENCODE_SANDBOX_OPENAI_API_KEY:-}}"
openai_api_key_cmd="${openai_api_key_cmd:-${OPENCODE_SANDBOX_OPENAI_API_KEY_CMD:-}}"
auth_source="${auth_source:-${OPENCODE_SANDBOX_AUTH_SOURCE:-}}"
use_real_auth="${use_real_auth:-${OPENCODE_SANDBOX_USE_REAL_AUTH:-}}"
theme="${theme:-${OPENCODE_SANDBOX_THEME:-}}"
prompt_plugin="${prompt_plugin:-${OPENCODE_SANDBOX_PROMPT_PLUGIN:-}}"
prompt_enabled="${prompt_enabled:-${OPENCODE_SANDBOX_PROMPT_ENABLED:-}}"
expect_cycle="${expect_cycle:-${OPENCODE_SANDBOX_EXPECT_IDLE_CYCLE:-}}"
sandbox_root="${sandbox_root:-${OPENCODE_SANDBOX_ROOT:-}}"
session_name="${session_name:-${OPENCODE_SANDBOX_SESSION_NAME:-}}"

if [[ "$repo_root_arg" != "1" && -n "${OPENCODE_SANDBOX_REPO_ROOT:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_REPO_ROOT" "--repo-root"
fi
if [[ "$evidence_dir_arg" != "1" && -n "${OPENCODE_SANDBOX_EVIDENCE_DIR:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_EVIDENCE_DIR" "--evidence-dir"
fi
if [[ "$opencode_dir_arg" != "1" && -n "${OPENCODE_SANDBOX_OPENCODE_DIR:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_OPENCODE_DIR" "--opencode-dir"
fi
if [[ "$model_arg" != "1" && -n "${OPENCODE_SANDBOX_MODEL:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_MODEL" "--model"
fi
if [[ "$pane_width_arg" != "1" && -n "${OPENCODE_SANDBOX_WIDTH:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_WIDTH" "--width"
fi
if [[ "$pane_height_arg" != "1" && -n "${OPENCODE_SANDBOX_HEIGHT:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_HEIGHT" "--height"
fi
if [[ "$openai_api_key_arg" != "1" && -n "${OPENCODE_SANDBOX_OPENAI_API_KEY:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_OPENAI_API_KEY" "--openai-api-key"
fi
if [[ "$openai_api_key_cmd_arg" != "1" && -n "${OPENCODE_SANDBOX_OPENAI_API_KEY_CMD:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_OPENAI_API_KEY_CMD" "--openai-api-key-cmd"
fi
if [[ "$auth_source_arg" != "1" && -n "${OPENCODE_SANDBOX_AUTH_SOURCE:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_AUTH_SOURCE" "--auth-source"
fi
if [[ "$use_real_auth_arg" != "1" && -n "${OPENCODE_SANDBOX_USE_REAL_AUTH:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_USE_REAL_AUTH" "--use-real-auth"
fi
if [[ "$theme_arg" != "1" && -n "${OPENCODE_SANDBOX_THEME:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_THEME" "--theme"
fi
if [[ "$prompt_plugin_arg" != "1" && -n "${OPENCODE_SANDBOX_PROMPT_PLUGIN:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_PROMPT_PLUGIN" "--prompt-plugin"
fi
if [[ "$prompt_enabled_arg" != "1" && -n "${OPENCODE_SANDBOX_PROMPT_ENABLED:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_PROMPT_ENABLED" "--prompt-enabled"
fi
if [[ "$expect_cycle_arg" != "1" && -n "${OPENCODE_SANDBOX_EXPECT_IDLE_CYCLE:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_EXPECT_IDLE_CYCLE" "--expect-idle-cycle"
fi
if [[ "$sandbox_root_arg" != "1" && -n "${OPENCODE_SANDBOX_ROOT:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_ROOT" "--root"
fi
if [[ "$session_name_arg" != "1" && -n "${OPENCODE_SANDBOX_SESSION_NAME:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_SESSION_NAME" "--session-name"
fi

if [[ -z "$openai_api_key" && -n "$openai_api_key_cmd" ]]; then
  openai_api_key="$(bash -lc "$openai_api_key_cmd")"
fi
if [[ -n "$openai_api_key" ]]; then
  export OPENCODE_SANDBOX_OPENAI_API_KEY="$openai_api_key"
fi

export PATH="$HOME/.bun/bin:$PATH"

export OPENCODE_PERMISSION='{"*":"allow"}'
export OPENCODE_DISABLE_DEFAULT_PLUGINS=1
export OPENCODE_DISABLE_LSP_DOWNLOAD=1
export OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=1
export OPENCODE_DISABLE_MODELS_FETCH=1

if [[ -z "$sandbox_root" ]]; then
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
tui_path="$XDG_CONFIG_HOME/opencode/tui.json"
auth_target_dir="$XDG_DATA_HOME/opencode"
auth_target="$auth_target_dir/auth.json"

if [[ "$state" != "error" ]]; then
  if [[ -n "$auth_source" ]]; then
    mkdir -p "$auth_target_dir"
    cp "$auth_source" "$auth_target"
  elif [[ "$use_real_auth" == "1" ]]; then
    if [[ -f "$HOME/.local/share/opencode/auth.json" ]]; then
      mkdir -p "$auth_target_dir"
      cp "$HOME/.local/share/opencode/auth.json" "$auth_target"
    fi
  fi
fi

if [[ -n "$theme" || -n "$prompt_plugin" || -n "$prompt_enabled" ]]; then
  enabled_json=""
  if [[ -n "$prompt_enabled" ]]; then
    case "$prompt_enabled" in
      1|true|TRUE|yes|YES|on|ON) enabled_json="true" ;;
      *) enabled_json="false" ;;
    esac
  fi

  {
    printf '{\n  "\\$schema": "https://opencode.ai/tui.json"'
    if [[ -n "$theme" ]]; then
      printf ',\n  "theme": "%s"' "$theme"
    fi
    if [[ -n "$prompt_plugin" || -n "$enabled_json" ]]; then
      printf ',\n  "prompt_bar_animation": {'
      wrote_field=0
      if [[ -n "$enabled_json" ]]; then
        printf '\n    "enabled": %s' "$enabled_json"
        wrote_field=1
      fi
      if [[ -n "$prompt_plugin" ]]; then
        if [[ "$wrote_field" -eq 1 ]]; then
          printf ',\n'
        else
          printf '\n'
        fi
        printf '    "plugin": "%s"' "$prompt_plugin"
      fi
      printf '\n  }'
    fi
    printf '\n}\n'
  } > "$tui_path"
fi

if [[ "$state" != "error" && -z "$openai_api_key" && ! -f "$auth_target" ]]; then
  echo "Provide --openai-api-key or copy auth.json into sandbox (--use-real-auth)"
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

if [[ -z "$session_name" ]]; then
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

tmux new-session -d -x "$pane_width" -y "$pane_height" -s "$session_name" "bash"
tmux send-keys -t "$session_name" "export PATH=\"$HOME/.bun/bin:$PATH\"" Enter
tmux send-keys -t "$session_name" "export XDG_DATA_HOME=$XDG_DATA_HOME XDG_CONFIG_HOME=$XDG_CONFIG_HOME XDG_STATE_HOME=$XDG_STATE_HOME XDG_CACHE_HOME=$XDG_CACHE_HOME OPENCODE_TEST_HOME=$OPENCODE_TEST_HOME OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_PERMISSION='$OPENCODE_PERMISSION' OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_DISABLE_LSP_DOWNLOAD=1 OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=1 OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_SANDBOX_PROMPT_ENABLED=${prompt_enabled} OPENCODE_SANDBOX_PROMPT_PLUGIN=${prompt_plugin} OPENCODE_SANDBOX_THEME=${theme}" Enter
tmux send-keys -t "$session_name" "export OPENCODE_SANDBOX_PROMPT_ENABLED=${prompt_enabled}" Enter
tmux send-keys -t "$session_name" "export OPENCODE_SANDBOX_PROMPT_PLUGIN=${prompt_plugin}" Enter
tmux send-keys -t "$session_name" "export OPENCODE_SANDBOX_THEME=${theme}" Enter
tmux send-keys -t "$session_name" "cd $opencode_dir" Enter
tmux send-keys -t "$session_name" "bun run dev -- --model $model" Enter

prompt_ready=0
for _ in {1..12}; do
  sleep 1
  if tmux capture-pane -e -t "$session_name" -p | sed -E 's/\x1b\[[0-9;]*[mK]//g' | rg -q "Ask anything|Build"; then
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
  check_args=(
    --repo-root "$repo_root"
    --evidence-dir "$evidence_dir"
  )
  if [[ -n "$model" ]]; then
    check_args+=(--model "$model")
  fi
  if [[ -n "$expect_cycle" ]]; then
    check_args+=(--expect-idle-cycle "$expect_cycle")
  fi
  bash "$check_script" "${check_args[@]}" "$state" "$evidence_file"
fi

echo "Captured ANSI evidence: $evidence_file"
