/**
 * Agent Hooks Constants
 *
 * Paths, markers, and configuration for CLI agent interception.
 */

import * as path from "path"
import * as os from "os"

// Base directories
export const CLAXEDO_DIR = path.join(os.homedir(), ".claxedo")
export const BIN_DIR = path.join(CLAXEDO_DIR, "bin")
export const HOOKS_DIR = path.join(CLAXEDO_DIR, "hooks")
export const SHELL_DIR = path.join(CLAXEDO_DIR, "shell")

// Markers for identifying our generated files
export const WRAPPER_MARKER = "# Claxedo agent-wrapper v1"
export const NOTIFY_MARKER = "# Claxedo agent notification hook v1"
export const SHELL_MARKER = "# Claxedo shell integration v1"

// File names
export const NOTIFY_SCRIPT = "notify.sh"
export const CLAUDE_SETTINGS = "claude-settings.json"

// Default port (will be overridden by actual OpenCode server port)
export const DEFAULT_HOOK_PORT = 7860

// Supported agents and their hook mechanisms
export const AGENTS = {
  claude: {
    name: "claude",
    hookType: "settings-file" as const, // Uses --settings flag
    settingsFile: CLAUDE_SETTINGS,
  },
  codex: {
    name: "codex",
    hookType: "config-flag" as const, // Uses -c 'notify=[...]'
  },
  amp: {
    name: "amp",
    hookType: "generic" as const,
  },
  aider: {
    name: "aider",
    hookType: "generic" as const,
  },
  goose: {
    name: "goose",
    hookType: "generic" as const,
  },
  cline: {
    name: "cline",
    hookType: "generic" as const,
  },
} as const

export type AgentName = keyof typeof AGENTS
export type HookType = "settings-file" | "config-flag" | "generic"

// Event types for agent lifecycle
export type AgentEventType = "Start" | "Stop" | "PermissionRequest"
