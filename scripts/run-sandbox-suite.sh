#!/usr/bin/env bash
set -euo pipefail

states=(error final stream tool warning)

usage() {
  echo "Usage: $0 [options]"
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
  echo "  -h, --help"
  echo ""
  echo "Env vars are deprecated (OPENCODE_SANDBOX_*). Prefer flags above."
}

warn_env() {
  echo "Deprecated: $1 is set. Use $2 instead." >&2
}

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
      echo "Unexpected argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

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

repo_root="${repo_root:-${OPENCODE_SANDBOX_REPO_ROOT:-}}"
if [[ -z "$repo_root" ]]; then
  repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fi
evidence_dir="${evidence_dir:-${OPENCODE_SANDBOX_EVIDENCE_DIR:-$repo_root/.sisyphus/evidence}}"
opencode_dir="${opencode_dir:-${OPENCODE_SANDBOX_OPENCODE_DIR:-$repo_root/packages/opencode}}"
model="${model:-${OPENCODE_SANDBOX_MODEL:-}}"
pane_width="${pane_width:-${OPENCODE_SANDBOX_WIDTH:-}}"
pane_height="${pane_height:-${OPENCODE_SANDBOX_HEIGHT:-}}"
openai_api_key="${openai_api_key:-${OPENCODE_SANDBOX_OPENAI_API_KEY:-}}"
openai_api_key_cmd="${openai_api_key_cmd:-${OPENCODE_SANDBOX_OPENAI_API_KEY_CMD:-}}"
auth_source="${auth_source:-${OPENCODE_SANDBOX_AUTH_SOURCE:-}}"
use_real_auth="${use_real_auth:-${OPENCODE_SANDBOX_USE_REAL_AUTH:-}}"
theme="${theme:-${OPENCODE_SANDBOX_THEME:-}}"
prompt_plugin="${prompt_plugin:-${OPENCODE_SANDBOX_PROMPT_PLUGIN:-}}"
prompt_enabled="${prompt_enabled:-${OPENCODE_SANDBOX_PROMPT_ENABLED:-}}"

if [[ -z "$openai_api_key" && -z "$openai_api_key_cmd" ]]; then
  echo "Provide --openai-api-key (or --openai-api-key-cmd) for non-error states."
fi

args=(
  --repo-root "$repo_root"
  --evidence-dir "$evidence_dir"
  --opencode-dir "$opencode_dir"
)
if [[ -n "$model" ]]; then
  args+=(--model "$model")
fi
if [[ -n "$pane_width" ]]; then
  args+=(--width "$pane_width")
fi
if [[ -n "$pane_height" ]]; then
  args+=(--height "$pane_height")
fi
if [[ -n "$openai_api_key" ]]; then
  args+=(--openai-api-key "$openai_api_key")
fi
if [[ -n "$openai_api_key_cmd" ]]; then
  args+=(--openai-api-key-cmd "$openai_api_key_cmd")
fi
if [[ -n "$auth_source" ]]; then
  args+=(--auth-source "$auth_source")
fi
if [[ "$use_real_auth" == "1" ]]; then
  args+=(--use-real-auth)
fi
if [[ -n "$theme" ]]; then
  args+=(--theme "$theme")
fi
if [[ -n "$prompt_plugin" ]]; then
  args+=(--prompt-plugin "$prompt_plugin")
fi
if [[ -n "$prompt_enabled" ]]; then
  args+=(--prompt-enabled "$prompt_enabled")
fi

for state in "${states[@]}"; do
  sandbox_root="/tmp/opencode-sandbox-${state}-$(date +%s)"
  session_name="opencode-sandbox-${state}-$(date +%s)"

  echo "\n==> Running state: $state"
  "$repo_root/scripts/run-sandbox-tui.sh" "${args[@]}" --root "$sandbox_root" --session-name "$session_name" "$state"
done
