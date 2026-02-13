/**
 * Agent Hooks Setup (Server-side)
 *
 * Creates wrapper scripts and shell integration for CLI agent lifecycle hooks.
 * This runs on the OpenCode server which has filesystem access.
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { Log } from "@/util/log"

const log = Log.create({ service: "agent-hooks" })

// Directories
const CLAXEDO_DIR = path.join(os.homedir(), ".claxedo")
const BIN_DIR = path.join(CLAXEDO_DIR, "bin")
const HOOKS_DIR = path.join(CLAXEDO_DIR, "hooks")
const SHELL_DIR = path.join(CLAXEDO_DIR, "shell")
const OPENCODE_CONFIG_DIR = path.join(CLAXEDO_DIR, "opencode-config")
const OPENCODE_PLUGIN_DIR = path.join(OPENCODE_CONFIG_DIR, "plugin")

// Markers
const WRAPPER_MARKER = "# Claxedo agent-wrapper v1"
const NOTIFY_MARKER = "# Claxedo agent notification hook v1"
const SHELL_MARKER = "# Claxedo shell integration v1"
const OPENCODE_PLUGIN_MARKER = "// Claxedo opencode plugin v1"

// File names
const NOTIFY_SCRIPT = "notify.sh"
const CLAUDE_SETTINGS = "claude-settings.json"
const OPENCODE_PLUGIN = "claxedo-notify.js"

/**
 * Find real binary function template (skips our wrapper directory)
 */
const FIND_REAL_BINARY = `
find_real_binary() {
  local name="$1"
  local IFS=':'
  for dir in $PATH; do
    [ -z "$dir" ] && continue
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
 * Generate the notify script
 */
function generateNotifyScript(port: number): string {
  const logFile = path.join(CLAXEDO_DIR, "debug.log")

  return `#!/bin/bash
${NOTIFY_MARKER}
# Called by CLI agents on lifecycle events

# Debug helper - writes to log file, not terminal
CLAXEDO_LOG="${logFile}"
debug() {
  [ "\${CLAXEDO_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [notify] $*" >> "$CLAXEDO_LOG"
}

debug "notify.sh called with args: $*"
debug "CLAXEDO_TAB_ID=$CLAXEDO_TAB_ID CLAXEDO_PORT=$CLAXEDO_PORT"

[ -z "$CLAXEDO_TAB_ID" ] && { debug "No CLAXEDO_TAB_ID, exiting"; exit 0; }

	if [ -n "$1" ]; then
	  INPUT="$1"
	else
	  # Read from stdin when piped. Avoid blocking if invoked without stdin.
	  if [ -t 0 ]; then
	    INPUT="{}"
	  else
	    INPUT=$(cat 2>/dev/null)
	    [ -z "$INPUT" ] && INPUT="{}"
	  fi
	fi

	debug "Raw input: $INPUT"

EVENT_TYPE=""

EVENT_TYPE=$(echo "$INPUT" | grep -oE '"hook_event_name"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"' 2>/dev/null)
debug "hook_event_name extracted: $EVENT_TYPE"

if [ -z "$EVENT_TYPE" ]; then
  CODEX_TYPE=$(echo "$INPUT" | grep -oE '"type"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"' 2>/dev/null)
  debug "Codex type extracted: $CODEX_TYPE"
  case "$CODEX_TYPE" in
    "agent-turn-complete") EVENT_TYPE="Stop" ;;
    "agent-turn-start") EVENT_TYPE="Start" ;;
    "permission-request") EVENT_TYPE="PermissionRequest" ;;
  esac
fi

case "$EVENT_TYPE" in
  "UserPromptSubmit") EVENT_TYPE="Start" ;;
esac

debug "Final EVENT_TYPE: $EVENT_TYPE"

[ -z "$EVENT_TYPE" ] && { debug "No event type, exiting"; exit 0; }

STATE_DIR="$HOME/.claxedo/state"
STATE_ID="\${CLAXEDO_TERMINAL_ID:-$CLAXEDO_TAB_ID}"
STATE_FILE="$STATE_DIR/$STATE_ID.agent"
mkdir -p "$STATE_DIR" 2>/dev/null || true

debug "State file: $STATE_FILE"

# Simple state tracking to prevent duplicate spurious Stop events
if [ "$EVENT_TYPE" = "Start" ] || [ "$EVENT_TYPE" = "PermissionRequest" ]; then
  echo "busy" > "$STATE_FILE" 2>/dev/null || true
  debug "State: marked busy"
fi

if [ "$EVENT_TYPE" = "Stop" ]; then
  if [ ! -f "$STATE_FILE" ]; then
    # First Stop for this terminal - allow it (handles Codex)
    echo "idle" > "$STATE_FILE" 2>/dev/null || true
    debug "State: first Stop, allowing"
  elif grep -q "^busy$" "$STATE_FILE" 2>/dev/null; then
    # Was busy, now idle
    echo "idle" > "$STATE_FILE" 2>/dev/null || true
    debug "State: marked idle"
  else
    # Already idle - duplicate Stop
    debug "Stop ignored: already idle"
    exit 0
  fi
fi

HOOK_URL="http://127.0.0.1:\${CLAXEDO_PORT:-${port}}/hook/agent-lifecycle"
debug "Calling: $HOOK_URL tabId=$CLAXEDO_TAB_ID eventType=$EVENT_TYPE"

(
  RESPONSE=$(curl -sG "$HOOK_URL" \\
    --connect-timeout 1 \\
    --max-time 2 \\
    --data-urlencode "tabId=$CLAXEDO_TAB_ID" \\
    --data-urlencode "terminalId=$CLAXEDO_TERMINAL_ID" \\
    --data-urlencode "workspaceId=$CLAXEDO_WORKSPACE_ID" \\
    --data-urlencode "eventType=$EVENT_TYPE" \\
    2>&1)
  CURL_EXIT=$?
  [ "\${CLAXEDO_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [notify] curl exit=$CURL_EXIT response=$RESPONSE" >> "$CLAXEDO_LOG"
) &

exit 0
`
}

/**
 * Generate Claude wrapper script
 */
function generateClaudeWrapper(): string {
  const settingsPath = path.join(HOOKS_DIR, CLAUDE_SETTINGS)
  const logFile = path.join(CLAXEDO_DIR, "debug.log")

  return `#!/bin/bash
${WRAPPER_MARKER}
set -uo pipefail

# Debug helper - writes to log file, not terminal
CLAXEDO_LOG="${logFile}"
debug() {
  [ "\${CLAXEDO_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [claude] $*" >> "$CLAXEDO_LOG"
}

debug "wrapper called args: $*"

${FIND_REAL_BINARY}

REAL_CLAUDE="$(find_real_binary "claude")"
debug "Real binary: \${REAL_CLAUDE:-not found}"

if [ -z "$REAL_CLAUDE" ]; then
  echo "Claxedo: claude not found in PATH." >&2
  exit 127
fi

for arg in "$@"; do
  case "$arg" in
    --settings|--settings=*)
      debug "User provided --settings, bypassing"
      exec "$REAL_CLAUDE" "$@"
      ;;
  esac
done

debug "Injecting settings: ${settingsPath}"
exec "$REAL_CLAUDE" --settings "${settingsPath}" "$@"
`
}

/**
 * Generate Claude settings JSON with hooks
 */
function generateClaudeSettings(notifyPath: string): string {
  const settings = {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: notifyPath }] }],
      Stop: [{ hooks: [{ type: "command", command: notifyPath }] }],
      PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: notifyPath }] }],
    },
  }
  return JSON.stringify(settings, null, 2)
}

/**
 * Generate Codex wrapper script
 */
function generateCodexWrapper(notifyPath: string): string {
  const logFile = path.join(CLAXEDO_DIR, "debug.log")

  return `#!/bin/bash
${WRAPPER_MARKER}
set -uo pipefail

# Debug helper - writes to log file, not terminal
CLAXEDO_LOG="${logFile}"
debug() {
  [ "\${CLAXEDO_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [codex] $*" >> "$CLAXEDO_LOG"
}

debug "wrapper called args: $*"

${FIND_REAL_BINARY}

REAL_CODEX="$(find_real_binary "codex")"
debug "Real binary: \${REAL_CODEX:-not found}"

if [ -z "$REAL_CODEX" ]; then
  echo "Claxedo: codex not found in PATH." >&2
  exit 127
fi

debug "Injecting notify: ${notifyPath}"

exec "$REAL_CODEX" -c 'notify=["bash","${notifyPath}"]' "$@"
`
}

/**
 * Generate generic wrapper for agents without native hook support
 */
function generateGenericWrapper(binaryName: string, notifyPath: string): string {
  const logFile = path.join(CLAXEDO_DIR, "debug.log")

  return `#!/bin/bash
${WRAPPER_MARKER}
set -uo pipefail

# Debug helper - writes to log file, not terminal
CLAXEDO_LOG="${logFile}"
debug() {
  [ "\${CLAXEDO_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [${binaryName}] $*" >> "$CLAXEDO_LOG"
}

debug "wrapper called args: $*"

${FIND_REAL_BINARY}

REAL_BIN="$(find_real_binary "${binaryName}")"
debug "Real binary: \${REAL_BIN:-not found}"

if [ -z "$REAL_BIN" ]; then
  echo "Claxedo: ${binaryName} not found in PATH." >&2
  exit 127
fi

if [ -n "\${CLAXEDO_TAB_ID:-}" ]; then
  debug "Sending Start event"
  echo '{"hook_event_name":"Start"}' | "${notifyPath}" 2>/dev/null &
fi

debug "Executing: $REAL_BIN $*"
"$REAL_BIN" "$@"
EXIT_CODE=$?

if [ -n "\${CLAXEDO_TAB_ID:-}" ]; then
  debug "Sending Stop event (exit=$EXIT_CODE)"
  echo '{"hook_event_name":"Stop"}' | "${notifyPath}" 2>/dev/null &
fi

exit $EXIT_CODE
`
}

/**
 * Generate OpenCode wrapper script
 * Sets OPENCODE_CONFIG_DIR to our config directory containing the plugin
 */
function generateOpenCodeWrapper(): string {
  const logFile = path.join(CLAXEDO_DIR, "debug.log")

  return `#!/bin/bash
${WRAPPER_MARKER}
set -uo pipefail

# Debug helper - writes to log file, not terminal
CLAXEDO_LOG="${logFile}"
debug() {
  [ "\${CLAXEDO_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [opencode] $*" >> "$CLAXEDO_LOG"
}

debug "wrapper called args: $*"

${FIND_REAL_BINARY}

REAL_OPENCODE="$(find_real_binary "opencode")"
debug "Real binary: \${REAL_OPENCODE:-not found}"

if [ -z "$REAL_OPENCODE" ]; then
  echo "Claxedo: opencode not found in PATH." >&2
  exit 127
fi

debug "Injecting OPENCODE_CONFIG_DIR: ${OPENCODE_CONFIG_DIR}"
export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR}"
exec "$REAL_OPENCODE" "$@"
`
}

/**
 * Generate OpenCode notification plugin
 * This hooks into OpenCode's internal events (session.status, permission.ask)
 */
function generateOpenCodePlugin(notifyPath: string): string {
  // Use template literal with escaped backticks for the shell command
  const shellCommand = "`bash ${notifyPath} ${payload}`"

  return `${OPENCODE_PLUGIN_MARKER}
/**
 * Claxedo Notification Plugin for OpenCode
 *
 * Hooks into session.status and permission.ask events to send notifications.
 */
export const ClaxedoNotifyPlugin = async ({ $ }) => {
  if (globalThis.__claxedoOpencodePluginV1) return {};
  globalThis.__claxedoOpencodePluginV1 = true;

  // Only run inside a Claxedo terminal session
  if (!process?.env?.CLAXEDO_TAB_ID) return {};

  const notifyPath = "${notifyPath}";

  // State tracking for deduplication
  let currentState = 'idle'; // 'idle' | 'busy'

  const notify = async (hookEventName) => {
    const payload = JSON.stringify({ hook_event_name: hookEventName });
    try {
      await $${shellCommand};
    } catch (err) {
      // Notification failed, silently ignore
    }
  };

  return {
    event: async ({ event }) => {
      // Skip child sessions (subagents)
      if (event.properties?.parentID) return;

      // Handle session status changes
      if (event.type === "session.status") {
        const status = event.properties?.status;
        if (status?.type === "busy" && currentState === 'idle') {
          currentState = 'busy';
          await notify('Start');
        } else if (status?.type === "idle" && currentState === 'busy') {
          currentState = 'idle';
          await notify('Stop');
        }
      }

      // Handle deprecated event types for backwards compatibility
      if (event.type === "session.busy" && currentState === 'idle') {
        currentState = 'busy';
        await notify('Start');
      }
      if (event.type === "session.idle" && currentState === 'busy') {
        currentState = 'idle';
        await notify('Stop');
      }

      // Handle session errors
      if (event.type === "session.error" && currentState === 'busy') {
        currentState = 'idle';
        await notify('Stop');
      }
    },
    "permission.ask": async (_permission, output) => {
      if (output.status === "ask") {
        await notify("PermissionRequest");
      }
    },
  };
};
`
}

/**
 * Generate zsh config for ZDOTDIR
 */
function generateZshrc(): string {
  const logFile = path.join(CLAXEDO_DIR, "debug.log")

  return `${SHELL_MARKER}
_CLAXEDO_ORIG_ZDOTDIR="\${CLAXEDO_ORIG_ZDOTDIR:-$HOME}"

# Debug helper - writes to log file, not terminal
_claxedo_debug() {
  [ "\${CLAXEDO_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [zsh] $*" >> "${logFile}"
}

_claxedo_debug "Loading .zshrc TAB_ID=\${CLAXEDO_TAB_ID:-unset}"

if [ -f "$_CLAXEDO_ORIG_ZDOTDIR/.zshenv" ]; then
  _claxedo_debug "Sourcing $_CLAXEDO_ORIG_ZDOTDIR/.zshenv"
  source "$_CLAXEDO_ORIG_ZDOTDIR/.zshenv"
fi

if [ -f "$_CLAXEDO_ORIG_ZDOTDIR/.zshrc" ]; then
  _claxedo_debug "Sourcing $_CLAXEDO_ORIG_ZDOTDIR/.zshrc"
  source "$_CLAXEDO_ORIG_ZDOTDIR/.zshrc"
fi

export PATH="${BIN_DIR}:\$PATH"
_claxedo_debug "PATH updated"
`
}

/**
 * Generate zshenv
 */
function generateZshenv(): string {
  return `${SHELL_MARKER}
if [ -z "\${CLAXEDO_ORIG_ZDOTDIR:-}" ]; then
  export CLAXEDO_ORIG_ZDOTDIR="\${ZDOTDIR:-$HOME}"
fi
`
}

/**
 * Generate bash config for BASH_ENV
 */
function generateBashrc(): string {
  const logFile = path.join(CLAXEDO_DIR, "debug.log")

  return `${SHELL_MARKER}
# Debug helper - writes to log file, not terminal
_claxedo_debug() {
  [ "\${CLAXEDO_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [bash] $*" >> "${logFile}"
}

_claxedo_debug "Loading .bashrc TAB_ID=\${CLAXEDO_TAB_ID:-unset}"

if [ -f "$HOME/.bashrc" ]; then
  _claxedo_debug "Sourcing $HOME/.bashrc"
  source "$HOME/.bashrc"
fi

export PATH="${BIN_DIR}:\$PATH"
_claxedo_debug "PATH updated"
`
}

/**
 * Write file if content changed
 */
async function writeIfChanged(filePath: string, content: string, mode: number, force: boolean): Promise<boolean> {
  const tempPath = `${filePath}.tmp.${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    if (!force && fs.existsSync(filePath)) {
      try {
        const existing = await fs.promises.readFile(filePath, "utf-8")
        if (existing === content) return false
      } catch {}
    }

    // Atomic write via temp file to prevent partial writes or race conditions
    await fs.promises.writeFile(tempPath, content, { mode })

    try {
      await fs.promises.rename(tempPath, filePath)
    } catch (renameError) {
      // Handle cross-device link errors by copying and deleting
      await fs.promises.copyFile(tempPath, filePath)
      await fs.promises.unlink(tempPath)
      await fs.promises.chmod(filePath, mode)
    }

    return true
  } catch (error) {
    log.error("Failed to write file", { filePath, error })
    // Attempt cleanup of temp file
    try {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath)
      }
    } catch {}
    throw error
  }
}

export interface SetupOptions {
  port?: number
  force?: boolean
}

/**
 * Set up agent hooks infrastructure
 */
export async function setupAgentHooks(options: SetupOptions = {}): Promise<void> {
  const { port = 7860, force = false } = options

  log.info("Setting up agent hooks", { port, force, DEBUG })

  if (DEBUG) {
    log.info("Agent hooks directories", {
      CLAXEDO_DIR,
      BIN_DIR,
      HOOKS_DIR,
      SHELL_DIR,
    })
  }

  // Create directories
  await fs.promises.mkdir(BIN_DIR, { recursive: true, mode: 0o755 })
  await fs.promises.mkdir(HOOKS_DIR, { recursive: true, mode: 0o755 })
  await fs.promises.mkdir(SHELL_DIR, { recursive: true, mode: 0o755 })
  await fs.promises.mkdir(OPENCODE_PLUGIN_DIR, { recursive: true, mode: 0o755 })

  const notifyPath = path.join(HOOKS_DIR, NOTIFY_SCRIPT)

  // Create notify script
  await writeIfChanged(notifyPath, generateNotifyScript(port), 0o755, force)

  // Create Claude wrapper and settings
  await writeIfChanged(path.join(BIN_DIR, "claude"), generateClaudeWrapper(), 0o755, force)
  await writeIfChanged(path.join(HOOKS_DIR, CLAUDE_SETTINGS), generateClaudeSettings(notifyPath), 0o644, force)

  // Create Codex wrapper
  await writeIfChanged(path.join(BIN_DIR, "codex"), generateCodexWrapper(notifyPath), 0o755, force)

  // Create OpenCode wrapper and plugin
  await writeIfChanged(path.join(BIN_DIR, "opencode"), generateOpenCodeWrapper(), 0o755, force)
  await writeIfChanged(
    path.join(OPENCODE_PLUGIN_DIR, OPENCODE_PLUGIN),
    generateOpenCodePlugin(notifyPath),
    0o644,
    force,
  )

  // Create generic wrappers
  for (const agent of ["amp", "aider", "goose", "cline"]) {
    await writeIfChanged(path.join(BIN_DIR, agent), generateGenericWrapper(agent, notifyPath), 0o755, force)
  }

  // Create shell integration
  await writeIfChanged(path.join(SHELL_DIR, ".zshrc"), generateZshrc(), 0o644, force)
  await writeIfChanged(path.join(SHELL_DIR, ".zshenv"), generateZshenv(), 0o644, force)
  await writeIfChanged(path.join(SHELL_DIR, ".bashrc"), generateBashrc(), 0o644, force)

  log.info("Agent hooks setup complete", { binDir: BIN_DIR })
}

/**
 * Check if setup is complete
 */
export function isSetupComplete(): boolean {
  const requiredFiles = [
    path.join(HOOKS_DIR, NOTIFY_SCRIPT),
    path.join(BIN_DIR, "claude"),
    path.join(BIN_DIR, "codex"),
    path.join(BIN_DIR, "opencode"),
    path.join(OPENCODE_PLUGIN_DIR, OPENCODE_PLUGIN),
    path.join(SHELL_DIR, ".zshrc"),
  ]
  return requiredFiles.every((file) => fs.existsSync(file))
}

// Check if debug mode is enabled
const DEBUG = process.env.CLAXEDO_DEBUG === "1"

/**
 * Get environment variables for terminal PTY
 */
export function getTerminalEnvVars(params: {
  tabId: string
  terminalId: string
  workspaceId: string
  port: number
  shell?: string
}): Record<string, string> {
  const { tabId, terminalId, workspaceId, port, shell } = params

  if (DEBUG) {
    log.info("getTerminalEnvVars called", params)
  }

  const env: Record<string, string> = {
    CLAXEDO_TAB_ID: tabId,
    CLAXEDO_TERMINAL_ID: terminalId,
    CLAXEDO_WORKSPACE_ID: workspaceId,
    CLAXEDO_PORT: String(port),
  }

  // Pass through debug flag to shell scripts
  if (DEBUG) {
    env.CLAXEDO_DEBUG = "1"
  }

  // Shell integration
  const shellName = shell?.split("/").pop() || ""
  if (shellName === "zsh" || shellName.includes("zsh")) {
    env.ZDOTDIR = SHELL_DIR
    env.CLAXEDO_ORIG_ZDOTDIR = process.env.ZDOTDIR || process.env.HOME || ""
    if (DEBUG) {
      log.info("Shell integration: zsh", { ZDOTDIR: env.ZDOTDIR })
    }
  } else if (shellName === "bash" || shellName.includes("bash")) {
    env.BASH_ENV = path.join(SHELL_DIR, ".bashrc")
    if (DEBUG) {
      log.info("Shell integration: bash", { BASH_ENV: env.BASH_ENV })
    }
  } else {
    // Fallback: directly modify PATH
    env.PATH = `${BIN_DIR}:${process.env.PATH || ""}`
    if (DEBUG) {
      log.info("Shell integration: fallback PATH modification", { shell: shellName })
    }
  }

  if (DEBUG) {
    log.info("Terminal env vars prepared", { tabId, terminalId, envKeys: Object.keys(env) })
  }

  return env
}

/**
 * Clean up agent hooks
 */
export async function cleanupAgentHooks(): Promise<void> {
  log.info("Cleaning up agent hooks")
  await fs.promises.rm(CLAXEDO_DIR, { recursive: true, force: true })
  log.info("Agent hooks cleanup complete")
}

// Export constants
export { CLAXEDO_DIR, BIN_DIR, HOOKS_DIR, SHELL_DIR, OPENCODE_CONFIG_DIR, OPENCODE_PLUGIN_DIR }
