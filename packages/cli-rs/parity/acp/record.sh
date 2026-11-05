#!/bin/sh
# P-WIRE recorder, the OPENCODE_ACP_TEST_BIN of `parity/acp/run.ts`. It runs `$ACP_RECORD_TARGET "$@"`
# (split on spaces) and records its stdin and stdout into a fresh directory under `$ACP_RECORD_DIR`:
# `in.ndjson` and `out.ndjson`, then `in.done` and `out.done` once each copy has finished.
#
# The agent replaces this shell (`exec`), so the test sees the agent's own pid and exit status, a
# signal included, and `pgrep -P <pid>` finds only the agent's private server. The two `tee` copies run
# detached (the subshell that starts them exits at once), so they are no children of the agent.
set -eu
dir="$ACP_RECORD_DIR/$(date +%s%N).$$"
mkdir -p "$dir"
mkfifo "$dir/in" "$dir/out"
exec 3<&0
# Neither copy keeps the test's stdout or stderr open: the test waits for both to close.
( { tee "$dir/in.ndjson" || true; : >"$dir/in.done"; } <&3 >"$dir/in" 2>>"$dir/tee.log" & )
( { tee "$dir/out.ndjson" || true; : >"$dir/out.done"; } <"$dir/out" 3<&- 2>>"$dir/tee.log" & )
# shellcheck disable=SC2086
exec $ACP_RECORD_TARGET "$@" <"$dir/in" >"$dir/out" 3<&-
