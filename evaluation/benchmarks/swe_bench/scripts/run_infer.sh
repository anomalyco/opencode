#!/usr/bin/env bash
# Bench entry script — invoked by gym's OpenCodeHarnessProcessor.get_run_command().
#
# Args (positional, must match the order in app.py's get_run_command):
#   $1  COMMIT_HASH        opencode commit (informational; checkout is done at setup)
#   $2  AGENT              agent class name (informational)
#   $3  MAX_ITER           max agent turns
#   $4  DATASET            dataset name (informational; gym already dispatched)
#   $5  SPLIT              dataset split (informational)
#   $6  EVAL_OUTPUT_DIR    where to write trajectories (relative to opencode dir)
#   $7  SELECTED_ID        instance_id to run
#   $8  INSTANCE_DICT_PATH /root/dataset/data.jsonl (single-line JSONL)
#   $9  CONFIG_FILE        opencode model config JSON (written by gym)
#   $10 WORKSPACE_ROOT     resolved repo path inside the SIF (gym side decided)
#   $11 USER_MESSAGE_PATH  pre-rendered user prompt file (workspace baked in)
#   $12 SYSTEM_PROMPT_PATH optional system-prompt override
#
# Environment (set by gym):
#   NEMO_GYM_MODEL_SERVER_NAME      proxy name on the gym head server
#   NEMO_GYM_MODEL_SERVER_BASE_URL  base http://host:port for the model server
#   NEMO_GYM_METRICS_FPATH          path to the metrics JSON to update
#   NEMO_GYM_CONFIG_DICT            (informational) the gym YAML config blob
#   COMMAND_EXEC_TIMEOUT            per-bash-command timeout in seconds
#   DIVERSIFY_TOOL_NAMES            optional: rename tools for RL diversity
#   CAMEL_CASE_TOOL_NAMES           optional: camelCase tool names

set -eo pipefail

COMMIT_HASH="${1:-}"
AGENT="${2:-OpenCodeAgent}"
MAX_ITER="${3:-100}"
DATASET="${4:-}"
SPLIT="${5:-test}"
EVAL_OUTPUT_DIR="${6:-evaluation/oh}"
SELECTED_ID="${7:-}"
INSTANCE_DICT_PATH="${8:-/root/dataset/data.jsonl}"
CONFIG_FILE="${9:-/tmp/oc_config.json}"
WORKSPACE_ROOT="${10:-}"
USER_MESSAGE_PATH="${11:-}"
SYSTEM_PROMPT_PATH="${12:-}"

if [ -z "$SELECTED_ID" ]; then
    echo "ERROR: SELECTED_ID (\$7) is required."
    exit 64
fi
if [ -z "$WORKSPACE_ROOT" ]; then
    echo "ERROR: WORKSPACE_ROOT (\$10) is required — gym side resolves the dataset-aware repo path."
    exit 65
fi
if [ -z "$USER_MESSAGE_PATH" ]; then
    echo "ERROR: USER_MESSAGE_PATH (\$11) is required — gym side renders the user prompt."
    exit 66
fi
if [ -z "${NEMO_GYM_MODEL_SERVER_NAME:-}" ]; then
    echo "ERROR: NEMO_GYM_MODEL_SERVER_NAME not set in env."
    exit 67
fi
if [ -z "${NEMO_GYM_MODEL_SERVER_BASE_URL:-}" ]; then
    echo "ERROR: NEMO_GYM_MODEL_SERVER_BASE_URL not set in env."
    exit 68
fi

# Resolve the opencode root directory. The script lives at
# evaluation/benchmarks/swe_bench/scripts/run_infer.sh — go up four levels.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCODE_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BENCH_CLI="$OPENCODE_DIR/packages/opencode/src/bench/cli.ts"

if [ ! -f "$BENCH_CLI" ]; then
    echo "ERROR: bench cli.ts not found at $BENCH_CLI"
    exit 69
fi
if ! command -v bun >/dev/null 2>&1; then
    echo "ERROR: bun not on PATH (expected /opencode_setup/bun/bin/bun)"
    exit 70
fi

# Make EVAL_OUTPUT_DIR absolute (relative to opencode dir).
case "$EVAL_OUTPUT_DIR" in
    /*) ABS_OUTPUT_DIR="$EVAL_OUTPUT_DIR" ;;
    *)  ABS_OUTPUT_DIR="$OPENCODE_DIR/$EVAL_OUTPUT_DIR" ;;
esac
mkdir -p "$ABS_OUTPUT_DIR"

echo "OPENCODE_DIR: $OPENCODE_DIR"
echo "BENCH_CLI: $BENCH_CLI"
echo "AGENT: $AGENT  COMMIT: $COMMIT_HASH  MAX_ITER: $MAX_ITER"
echo "DATASET: $DATASET  SPLIT: $SPLIT  SELECTED_ID: $SELECTED_ID"
echo "EVAL_OUTPUT_DIR: $ABS_OUTPUT_DIR"
echo "INSTANCE_DICT_PATH: $INSTANCE_DICT_PATH"
echo "CONFIG_FILE: $CONFIG_FILE"
echo "WORKSPACE_ROOT: $WORKSPACE_ROOT"
echo "USER_MESSAGE_PATH: $USER_MESSAGE_PATH"
echo "SYSTEM_PROMPT_PATH: $SYSTEM_PROMPT_PATH"
echo "MODEL_SERVER: $NEMO_GYM_MODEL_SERVER_NAME @ $NEMO_GYM_MODEL_SERVER_BASE_URL"

cmd=(
    bun "$BENCH_CLI"
    --instance-dict-path "$INSTANCE_DICT_PATH"
    --output-dir "$ABS_OUTPUT_DIR"
    --config "$CONFIG_FILE"
    --max-turns "$MAX_ITER"
    --agent-cls "$AGENT"
    --dataset "$DATASET"
    --split "$SPLIT"
    --selected-id "$SELECTED_ID"
    --workspace-root "$WORKSPACE_ROOT"
    --user-message-file "$USER_MESSAGE_PATH"
)
if [ -n "$SYSTEM_PROMPT_PATH" ]; then
    cmd+=(--system-prompt "$SYSTEM_PROMPT_PATH")
fi

echo "Executing: ${cmd[*]}"
exec "${cmd[@]}"
