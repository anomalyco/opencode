#!/usr/bin/env bash
# capture-freeze.sh — collect objective evidence while opencode-desktop is frozen.
#
# Usage (run from any terminal while UI is frozen — DO NOT force-quit first):
#
#   bash /Users/lelouch/apps/opencode/.trellis/tasks/05-01-streaming-flicker-and-perf/scripts/capture-freeze.sh
#
# Output goes to ~/oc-freeze-<timestamp>/ — give that directory back to the assistant.
#
# What it captures:
#   1. ps snapshot of every opencode-related process (PID/CPU/RSS/state/cmdline)
#   2. macOS `sample` (5 s call-stack profile) of:
#        - the Tauri Rust main process
#        - the bundled Bun sidecar (opencode backend)
#        - every WebKit WebContent / Networking / GPU XPC service
#   3. system memory & VM stats
#   4. fs_usage on the desktop process for 3 s (file/IPC syscalls)
#
# All capture is read-only; nothing is killed or modified.

set -u

ts=$(date +%Y%m%d-%H%M%S)
out="$HOME/oc-freeze-$ts"
mkdir -p "$out"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$out/00-run.log"; }

log "output dir: $out"
log "host: $(uname -a)"
log "uptime: $(uptime)"

# ---------------- 1. process snapshot ----------------
log "1/4  process snapshot"
{
  echo "# ps -A wide snapshot"
  ps -A -o pid,ppid,user,%cpu,%mem,rss,vsz,state,etime,command 2>/dev/null \
    | head -1
  ps -A -o pid,ppid,user,%cpu,%mem,rss,vsz,state,etime,command 2>/dev/null \
    | grep -Ei 'opencode|tauri|bun|WebKit\.WebContent|WebKit\.Networking|WebKit\.GPU' \
    | grep -v 'capture-freeze\.sh' \
    | grep -v ' grep '
} > "$out/01-ps.txt" 2>&1

# ---------------- 2. find PIDs ----------------
log "2/4  resolve target PIDs"

# Tauri Rust main: the binary ships as 'opencode-desktop' (or 'OpenCode' under .app)
MAIN_PIDS=$( { pgrep -x opencode-desktop; pgrep -f 'OpenCode\.app/Contents/MacOS'; pgrep -f 'opencode-desktop'; } 2>/dev/null | sort -u | tr '\n' ' ')

# Bun sidecar: the opencode backend launched as a child of the desktop
BUN_PIDS=$( { pgrep -x bun; pgrep -f 'opencode/dist/index'; pgrep -f 'opencode/packages/opencode'; } 2>/dev/null | sort -u | tr '\n' ' ')

# WebKit content/networking/GPU XPCs — sample any with >0.5% CPU. Cheap; broad net.
WK_PIDS=$(ps -A -o pid,%cpu,command 2>/dev/null \
  | awk '/WebKit\.(WebContent|Networking|GPU)/ && $2+0 > 0.5 {print $1}' \
  | sort -u | tr '\n' ' ')

ALL_PIDS=$(printf '%s %s %s\n' "$MAIN_PIDS" "$BUN_PIDS" "$WK_PIDS" | tr ' ' '\n' | awk 'NF' | sort -u | tr '\n' ' ')

{
  echo "# resolved PIDs"
  echo "main (Tauri Rust): ${MAIN_PIDS:-<none found>}"
  echo "bun (backend)    : ${BUN_PIDS:-<none found>}"
  echo "webkit (>0.5%cpu): ${WK_PIDS:-<none found>}"
  echo "all to sample    : ${ALL_PIDS:-<none>}"
} > "$out/02-pids.txt" 2>&1
cat "$out/02-pids.txt"

if [ -z "${ALL_PIDS// }" ]; then
  log "ERROR: no opencode-desktop processes found. Is the app actually running?"
  log "       (If you already force-quit, this script can't help — run it next time *while* still frozen.)"
  exit 1
fi

# ---------------- 3. sample call stacks ----------------
log "3/4  sample call stacks (5 s each, parallel)"
for pid in $ALL_PIDS; do
  (
    cmd=$(ps -p "$pid" -o command= 2>/dev/null | head -c 60 | tr '/' '_' | tr ' ' '_' | tr -dc 'A-Za-z0-9_.-')
    out_file="$out/03-sample-$pid-${cmd}.txt"
    sample "$pid" 5 -file "$out_file" >/dev/null 2>&1 || echo "sample failed for $pid" > "$out_file.err"
  ) &
done
wait

# ---------------- 4. fs / vm stats ----------------
log "4/4  vm_stat + fs_usage (3 s)"
vm_stat > "$out/04-vm_stat-before.txt" 2>&1

# fs_usage requires sudo on some systems; try without first
MAIN0=$(echo $MAIN_PIDS | awk '{print $1}')
if [ -n "$MAIN0" ]; then
  timeout 3 fs_usage -w -e -f filesys "$MAIN0" > "$out/04-fs_usage.txt" 2>&1 \
    || echo "fs_usage needs sudo on this system — re-run with sudo for this part" > "$out/04-fs_usage.txt"
fi

vm_stat > "$out/04-vm_stat-after.txt" 2>&1

# ---------------- 5. summary ----------------
{
  echo "# capture summary"
  echo "timestamp: $ts"
  echo "files captured: $(ls -1 "$out" | wc -l | tr -d ' ')"
  ls -lh "$out"
} > "$out/99-summary.txt" 2>&1

log "DONE — give this directory to the assistant: $out"
log "tar -czf ~/oc-freeze-$ts.tgz -C \"$HOME\" \"oc-freeze-$ts\"  # optional, for sharing"
