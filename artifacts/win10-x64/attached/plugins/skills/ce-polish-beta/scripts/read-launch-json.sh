#!/usr/bin/env bash
#
# read-launch-json.sh — read .claude/launch.json from the repo root and emit
# the selected configuration as JSON on stdout, or a sentinel on failure.
#
# Usage:
#   read-launch-json.sh [config-name]
#
# Arguments:
#   config-name (optional) — if multiple configurations exist and this arg
#                            matches a configuration's `name`, emit that one.
#                            If omitted and there are multiple configurations,
#                            emit a __MULTIPLE_CONFIGS__ sentinel followed by a
#                            JSON array of configuration names on the next line.
#
# Output contract:
#   Success: single-line JSON object on stdout representing the chosen
#            configuration. Shape mirrors VS Code's launch.json entry:
#            {name, runtimeExecutable, runtimeArgs, port, cwd, env}.
#   Sentinels (printed to stdout, one per line):
#     __NO_LAUNCH_JSON__           - file not found
#     __INVALID_LAUNCH_JSON__      - file exists but fails JSON parsing
#     __MISSING_CONFIGURATIONS__   - valid JSON but no `configurations` array
#     __MULTIPLE_CONFIGS__         - ambiguity, needs caller disambiguation.
#                                    Followed by a JSON array of names on line 2.
#     __CONFIG_NOT_FOUND__         - caller-provided name doesn't match any entry
#
# The script never exits non-zero for a missing or malformed file -- callers
# parse the sentinel and decide how to proceed. Exit code 1 is reserved for
# genuine operational failures (missing `jq`, git root not found).

set -u

REQUESTED_NAME="${1:-}"

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  echo "ERROR: not in a git repository" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed" >&2
  exit 1
fi

LAUNCH_PATH="$REPO_ROOT/.claude/launch.json"

if [ ! -f "$LAUNCH_PATH" ]; then
  echo "__NO_LAUNCH_JSON__"
  exit 0
fi

# Validate JSON. We parse with `jq empty` so malformed JSON is caught
# before any downstream query runs.
if ! jq empty "$LAUNCH_PATH" >/dev/null 2>&1; then
  echo "__INVALID_LAUNCH_JSON__"
  exit 0
fi

CONFIG_COUNT=$(jq '(.configurations // []) | length' "$LAUNCH_PATH")

if [ "$CONFIG_COUNT" = "0" ]; then
  echo "__MISSING_CONFIGURATIONS__"
  exit 0
fi

if [ "$CONFIG_COUNT" = "1" ]; then
  jq -c '.configurations[0]' "$LAUNCH_PATH"
  exit 0
fi

# Multiple configurations. If the caller named one, emit it. Otherwise, emit
# the sentinel + name list so the caller can prompt the user.
if [ -n "$REQUESTED_NAME" ]; then
  MATCH=$(jq -c --arg name "$REQUESTED_NAME" '.configurations[] | select(.name == $name)' "$LAUNCH_PATH")
  if [ -z "$MATCH" ]; then
    echo "__CONFIG_NOT_FOUND__"
    exit 0
  fi
  echo "$MATCH"
  exit 0
fi

echo "__MULTIPLE_CONFIGS__"
jq -c '[.configurations[].name]' "$LAUNCH_PATH"
exit 0
