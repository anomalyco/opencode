#!/bin/bash

# Measurement Runner
# Runs a measurement command, captures JSON output, and handles timeouts.
# The orchestrating agent (not this script) evaluates gates and handles
# stability repeats.
#
# Usage: measure.sh <command> <timeout_seconds> [working_directory] [KEY=VALUE ...]
#
# Arguments:
#   command          - Shell command to run (e.g., "python evaluate.py")
#   timeout_seconds  - Maximum seconds before killing the command
#   working_directory - Directory to run the command in (default: .)
#   KEY=VALUE        - Optional environment variables to set before running
#
# Output:
#   stdout: Raw JSON output from the measurement command
#   stderr: Passed through from the measurement command
#   exit code: Same as the measurement command (124 for timeout)

set -euo pipefail

# Parse arguments
COMMAND="${1:?Error: command argument required}"
TIMEOUT="${2:?Error: timeout_seconds argument required}"
shift 2

WORKDIR="."
if [[ $# -gt 0 ]] && [[ "$1" != *=* ]]; then
  WORKDIR="$1"
  shift
fi

# Set any KEY=VALUE environment variables
for arg in "$@"; do
  if [[ "$arg" == *=* ]]; then
    export "$arg"
  fi
done

# Change to working directory
cd "$WORKDIR" || {
  echo "Error: cannot cd to $WORKDIR" >&2
  exit 1
}

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$TIMEOUT" bash -c "$COMMAND"
    return
  fi

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$TIMEOUT" bash -c "$COMMAND"
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$TIMEOUT" "$COMMAND" <<'PY'
import os
import signal
import subprocess
import sys

timeout_seconds = int(sys.argv[1])
command = sys.argv[2]
proc = subprocess.Popen(["bash", "-c", command], start_new_session=True)

try:
    sys.exit(proc.wait(timeout=timeout_seconds))
except subprocess.TimeoutExpired:
    os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
    sys.exit(124)
PY
    return
  fi

  echo "Error: no timeout implementation available (tried timeout, gtimeout, python3)" >&2
  exit 1
}

# Run the measurement command with timeout
# timeout returns 124 if the command times out
# We pass stdout and stderr through directly
run_with_timeout
