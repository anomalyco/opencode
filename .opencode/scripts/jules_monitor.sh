#!/usr/bin/env bash
# Poll Jules remote sessions and log state transitions for tracked in-flight work.
# Safe for cron (no TTY): pipes /dev/null to the CLI, parses the fixed-width table.
#
# Log: ~/.jules/jules_monitor.log   (append-only transition + stuck-duration records)
# State: ~/.jules/monitor_state     (id -> last-seen status)
# Tracked: ~/.jules/tracked_sessions ("id workspace" per line, add/remove at runtime)
#
# Usage:
#   jules_monitor.sh                       poll all tracked sessions (cron mode)
#   jules_monitor.sh install [workspace]   install workspace-scoped cron entry (defaults to $PWD)
#   jules_monitor.sh add <id> [workspace]  start tracking a session (workspace defaults to $PWD)
#   jules_monitor.sh remove <id>           stop tracking a session
#   jules_monitor.sh list [workspace]      list tracked sessions (filtered to workspace if given)
set -u

JULES_BIN="${JULES_BIN:-$HOME/.npm-global/bin/jules}"
[ -x "$JULES_BIN" ] || JULES_BIN="$(command -v jules 2>/dev/null)"
[ -n "$JULES_BIN" ] || { echo "$(date '+%Y-%m-%d %H:%M:%S')  FATAL  jules CLI not found" >> "$HOME/.jules/jules_monitor.log"; exit 1; }

LOG="$HOME/.jules/jules_monitor.log"
STATE="$HOME/.jules/monitor_state"
TRACKED="$HOME/.jules/tracked_sessions"

touch "$LOG" "$STATE" "$TRACKED"

# Fetch the session listing once and parse it structurally: the table splits on
# 2+ spaces, so ID/repo/status are stable field positions regardless of emoji
# width in descriptions (which broke fixed-column offsets).
LISTING="$("$JULES_BIN" remote list --session </dev/null 2>/dev/null)"

# Parse status for a given session ID: last non-empty field of its row.
status_for() {
    local id="$1"
    printf '%s\n' "$LISTING" \
      | awk -v id="$id" 'index($0, id) && $1 ~ id {
          split($0, a, / {2,}/)
          s = a[5]
          gsub(/^ +| +$/, "", s)
          print s
          exit
        }'
}

# Parse repo for a given session ID: the third field of its row.
repo_for() {
    local id="$1"
    printf '%s\n' "$LISTING" \
      | awk -v id="$id" 'index($0, id) && $1 ~ id {
          n = split($0, a, / {2,}/)
          gsub(/^ +| +$/, "", a[3])
          print a[3]
          exit
        }'
}

# Map truncated CLI status back to full enum.
normalize() {
    local s="$1"
    case "$s" in
        Awaiting*) echo "AWAITING_USER_FEEDBACK";;
        In*)       echo "IN_PROGRESS";;
        Completed*) echo "COMPLETED";;
        Planning*) echo "PLANNING";;
        Failed*)   echo "FAILED";;
        Queued*)   echo "QUEUED";;
        Blocked*)  echo "BLOCKED";;
        *)         echo "$s";;
    esac
}

case "${1:-}" in
    install)
        ws="${2:-${PWD}}"
        cron_entry="*/5 * * * * cd $ws && $HOME/.config/opencode/scripts/jules_monitor.sh"
        crontab_content="$(crontab -l 2>/dev/null || true)"
        if printf '%s\n' "$crontab_content" | grep -Fq "cd $ws &&"; then
            echo "cron already installed for $ws"
        else
            (printf '%s\n' "$crontab_content"; echo "$cron_entry") | crontab -
            echo "installed cron for $ws"
        fi
        exit 0
        ;;
    add)
        [ -n "${2:-}" ] || { echo "usage: jules_monitor.sh add <session-id> [workspace]"; exit 1; }
        ws="${3:-${PWD}}"
        if grep -qE "^${2} " "$TRACKED"; then
            echo "already tracking $2"
        else
            echo "$2 $ws" >> "$TRACKED"
            echo "tracking $2 ($ws)"
        fi
        exit 0
        ;;
    remove)
        [ -n "${2:-}" ] || { echo "usage: jules_monitor.sh remove <session-id>"; exit 1; }
        sed -i "/^$2 /d" "$TRACKED"
        echo "stopped tracking $2"
        exit 0
        ;;
    list)
        ws="${2:-}"
        while read -r id tracked_ws; do
            [ -z "$id" ] && continue
            [ -n "$ws" ] && [ "$tracked_ws" != "$ws" ] && continue
            echo "$id  ${tracked_ws:-?}  $(repo_for "$id")  $(normalize "$(status_for "$id")")"
        done < "$TRACKED"
        exit 0
        ;;
esac

TS="$(date '+%Y-%m-%d %H:%M:%S')"
NOW="$(date +%s)"

# Prune state entries for sessions no longer tracked.
awk 'NR==FNR { keep[$1]=1; next } keep[$1]' "$TRACKED" "$STATE" > "$STATE.tmp" \
  && mv "$STATE.tmp" "$STATE"

while read -r id _ws; do
    [ -z "$id" ] && continue
    raw="$(status_for "$id")"
    [ -z "$raw" ] && raw="UNKNOWN"
    status="$(normalize "$raw")"
    repo="$(repo_for "$id")"
    ctx="${repo:+ ($repo)}"
    prev="$(grep -E "^${id} " "$STATE" 2>/dev/null | awk '{print $2}')"
    [ -z "$prev" ] && prev="UNKNOWN"

    if [ "$prev" != "$status" ]; then
        # Transition: log it.
        echo "$TS  TRANSITION  $id$ctx: $prev -> $status" >> "$LOG"
        # Reset first-seen timestamp for the new state.
        sed -i "/^${id} /d" "$STATE"
        echo "$id $status $NOW" >> "$STATE"
    else
        # Same state: update first-seen timestamp if it was never set.
        if ! grep -qE "^${id} " "$STATE"; then
            echo "$id $status $NOW" >> "$STATE"
        fi
    fi
done < "$TRACKED"

# Report sessions that have been stuck in AWAITING_USER_FEEDBACK or FAILED
# for more than 15 minutes (needs a nudge / force-resolve).
while read -r id status since; do
    [ -z "$id" ] && continue
    repo="$(repo_for "$id")"
    ctx="${repo:+ ($repo)}"
    if [ "$status" = "AWAITING_USER_FEEDBACK" ] || [ "$status" = "FAILED" ]; then
        age=$(( (NOW - since) / 60 ))
        if [ "$age" -ge 15 ]; then
            echo "$TS  STUCK>=${age}m  $id$ctx  status=$status (needs nudge/resolve)" >> "$LOG"
        fi
    fi
    if [ "$status" = "COMPLETED" ]; then
        echo "$TS  COMPLETED     $id$ctx (check PR link)" >> "$LOG"
    fi
done < "$STATE"

# Keep the log bounded.
tail -n 400 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 0