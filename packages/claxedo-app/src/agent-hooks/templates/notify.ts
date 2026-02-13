/**
 * Notify Script Template
 *
 * Generates the shell script that CLI agents call on lifecycle events.
 * The script parses JSON input from various agent formats and calls
 * the Claxedo server to update tab status.
 */

import { NOTIFY_MARKER, DEFAULT_HOOK_PORT } from "../constants"

export function generateNotifyScript(port: number = DEFAULT_HOOK_PORT): string {
  return `#!/bin/bash
${NOTIFY_MARKER}
# Called by CLI agents (Claude, Codex, Amp, etc.) on lifecycle events
# Sends status updates to Claxedo for tab indicators

# Only run if inside a Claxedo terminal
[ -z "$CLAXEDO_TAB_ID" ] && exit 0

# Get JSON input - some agents pass as arg, others pipe to stdin
if [ -n "$1" ]; then
  INPUT="$1"
else
  # Read from stdin with timeout to avoid blocking
  INPUT=$(timeout 1 cat 2>/dev/null || echo "{}")
fi

# Extract event type from various agent formats
EVENT_TYPE=""

# Try Claude format: "hook_event_name": "Start|Stop|PermissionRequest"
if [ -z "$EVENT_TYPE" ]; then
  EVENT_TYPE=$(echo "$INPUT" | grep -oE '"hook_event_name"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"' 2>/dev/null)
fi

# Try Codex format: "type": "agent-turn-complete|agent-turn-start|permission-request"
if [ -z "$EVENT_TYPE" ]; then
  CODEX_TYPE=$(echo "$INPUT" | grep -oE '"type"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"' 2>/dev/null)
  case "$CODEX_TYPE" in
    "agent-turn-complete") EVENT_TYPE="Stop" ;;
    "agent-turn-start") EVENT_TYPE="Start" ;;
    "permission-request") EVENT_TYPE="PermissionRequest" ;;
  esac
fi

# Try generic format: "event": "start|stop|permission"
if [ -z "$EVENT_TYPE" ]; then
  GENERIC_TYPE=$(echo "$INPUT" | grep -oE '"event"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"' 2>/dev/null)
  case "$GENERIC_TYPE" in
    "start") EVENT_TYPE="Start" ;;
    "stop"|"complete"|"done") EVENT_TYPE="Stop" ;;
    "permission"|"input"|"prompt") EVENT_TYPE="PermissionRequest" ;;
  esac
fi

# Map variations to canonical names
case "$EVENT_TYPE" in
  "UserPromptSubmit") EVENT_TYPE="Start" ;;
  "TaskComplete"|"AgentStop") EVENT_TYPE="Stop" ;;
esac

# Skip if no event type found (don't send empty events)
[ -z "$EVENT_TYPE" ] && exit 0

# Send to Claxedo server (non-blocking with timeout)
# Use background process to avoid blocking the agent
(
  curl -sG "http://127.0.0.1:\${CLAXEDO_PORT:-${port}}/hook/agent-lifecycle" \\
    --connect-timeout 1 \\
    --max-time 2 \\
    --data-urlencode "tabId=$CLAXEDO_TAB_ID" \\
    --data-urlencode "terminalId=$CLAXEDO_TERMINAL_ID" \\
    --data-urlencode "workspaceId=$CLAXEDO_WORKSPACE_ID" \\
    --data-urlencode "eventType=$EVENT_TYPE" \\
    > /dev/null 2>&1
) &

exit 0
`
}
