/**
 * Agent Wrapper Templates
 *
 * Generates shell wrapper scripts that intercept CLI agent calls
 * and inject lifecycle hooks.
 */

import * as path from "path"
import { BIN_DIR, HOOKS_DIR, WRAPPER_MARKER, CLAUDE_SETTINGS } from "../constants"

/**
 * Common function to find the real binary, skipping our wrapper directory
 */
const FIND_REAL_BINARY = `
find_real_binary() {
  local name="$1"
  local IFS=':'
  for dir in $PATH; do
    [ -z "$dir" ] && continue
    # Skip our wrapper directory
    case "$dir" in
      "${BIN_DIR}"|"$HOME/.claxedo/bin") continue ;;
    esac
    if [ -x "$dir/$name" ] && [ ! -d "$dir/$name" ]; then
      printf "%s\\n" "$dir/$name"
      return 0
    fi
  done
  return 1
}
`

/**
 * Generate Claude wrapper script
 * Uses --settings flag to inject hooks
 */
export function generateClaudeWrapper(): string {
  const settingsPath = path.join(HOOKS_DIR, CLAUDE_SETTINGS)

  return `#!/bin/bash
${WRAPPER_MARKER}
# Claxedo wrapper for Claude Code
# Injects notification hooks while preserving all functionality

set -uo pipefail

${FIND_REAL_BINARY}

REAL_CLAUDE="$(find_real_binary "claude")"

if [ -z "$REAL_CLAUDE" ]; then
  echo "Claxedo: claude not found in PATH. Please install Claude Code first." >&2
  echo "  npm install -g @anthropic-ai/claude-code" >&2
  exit 127
fi

# If user provides --settings, respect theirs (don't override)
for arg in "$@"; do
  case "$arg" in
    --settings|--settings=*)
      exec "$REAL_CLAUDE" "$@"
      ;;
  esac
done

# Inject our settings with hooks
exec "$REAL_CLAUDE" --settings "${settingsPath}" "$@"
`
}

/**
 * Generate Claude settings JSON with hooks
 */
export function generateClaudeSettings(notifyPath: string): string {
  const settings = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: notifyPath }] }
      ],
      Stop: [
        { hooks: [{ type: "command", command: notifyPath }] }
      ],
      PermissionRequest: [
        { matcher: "*", hooks: [{ type: "command", command: notifyPath }] }
      ],
    },
  }
  return JSON.stringify(settings, null, 2)
}

/**
 * Generate Codex wrapper script
 * Uses -c 'notify=[...]' config flag
 */
export function generateCodexWrapper(notifyPath: string): string {
  return `#!/bin/bash
${WRAPPER_MARKER}
# Claxedo wrapper for Codex
# Injects notification hooks via config flag

set -uo pipefail

${FIND_REAL_BINARY}

REAL_CODEX="$(find_real_binary "codex")"

if [ -z "$REAL_CODEX" ]; then
  echo "Claxedo: codex not found in PATH. Please install Codex first." >&2
  exit 127
fi

# Inject notify hook via -c flag
# Codex accepts notify config that calls a script with JSON
exec "$REAL_CODEX" -c 'notify=["bash","${notifyPath}"]' "$@"
`
}

/**
 * Generate generic wrapper for agents without native hook support
 * Tracks start/exit by wrapping the execution
 */
export function generateGenericWrapper(binaryName: string, notifyPath: string): string {
  return `#!/bin/bash
${WRAPPER_MARKER}
# Claxedo wrapper for ${binaryName}
# Tracks start/exit (agent may not support lifecycle hooks natively)

set -uo pipefail

${FIND_REAL_BINARY}

REAL_BIN="$(find_real_binary "${binaryName}")"

if [ -z "$REAL_BIN" ]; then
  echo "Claxedo: ${binaryName} not found in PATH." >&2
  exit 127
fi

# Only send hooks if inside a Claxedo terminal
if [ -n "\${CLAXEDO_TAB_ID:-}" ]; then
  # Notify start (background to not block)
  echo '{"hook_event_name":"Start"}' | "${notifyPath}" 2>/dev/null &
fi

# Run the real binary and capture exit code
"$REAL_BIN" "$@"
EXIT_CODE=$?

# Notify stop (background to not block)
if [ -n "\${CLAXEDO_TAB_ID:-}" ]; then
  echo '{"hook_event_name":"Stop"}' | "${notifyPath}" 2>/dev/null &
fi

exit $EXIT_CODE
`
}

/**
 * Get list of all agent names we create wrappers for
 */
export function getWrapperAgentNames(): string[] {
  return ["claude", "codex", "amp", "aider", "goose", "cline"]
}
