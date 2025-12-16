import type { MatchResult } from "../util/match.js"
import { fuzzyMatch } from "../util/match.js"
import { AGENT_DEFINITIONS } from "./agent-definitions.js"

export interface InstallCommand {
  method: string // e.g., "npm", "brew", "curl", "cargo", "uv"
  command: string // the actual command to run
  description?: string
}

export interface ACPAgentDefinition {
  name: string
  description: string
  command: string // the binary name to execute (also checked via Bun.which for detection)
  acpStartupArgs: string[]
  installCommands: {
    unix: InstallCommand[] // macOS/Linux
    windows: InstallCommand[]
  }
  uninstallCommands?: {
    unix: InstallCommand[]
    windows: InstallCommand[]
  }
  installGuide?: string
  color?: string // Hex color for UI elements (e.g., prompt border)
  // Legacy fields for backward compatibility with CLI checking
  installMethod?: "npx" | "uvx" | "system" | "skip"
  installCheck?: string
  // Alias for acpStartupArgs for backward compatibility
  args?: string[]
}

/**
 * All available ACP agents, sorted by name for consistent ordering.
 * Agent definitions are imported from agent-definitions.ts.
 */
export const ACP_AGENTS: ACPAgentDefinition[] = [...AGENT_DEFINITIONS].sort((a, b) => a.name.localeCompare(b.name))

export function getAgent(name: string): ACPAgentDefinition | undefined {
  return ACP_AGENTS.find((agent) => agent.name === name)
}

export function getInstallCommandsForPlatform(
  agent: ACPAgentDefinition,
  platform: NodeJS.Platform = process.platform,
): InstallCommand[] {
  return platform === "win32" ? agent.installCommands.windows : agent.installCommands.unix
}

export function getUninstallCommandsForPlatform(
  agent: ACPAgentDefinition,
  platform: NodeJS.Platform = process.platform,
): InstallCommand[] {
  if (!agent.uninstallCommands) return []
  return platform === "win32" ? agent.uninstallCommands.windows : agent.uninstallCommands.unix
}

export function matchAgent(name: string): MatchResult<ACPAgentDefinition> {
  return fuzzyMatch(name, ACP_AGENTS, (agent) => agent.name)
}

export function getAllAgents(): ACPAgentDefinition[] {
  return ACP_AGENTS
}

// No default agent - user must select on first launch
// After selection, their choice is stored in KV as the default for future sessions
export const DEFAULT_AGENT: ACPAgentDefinition | null = null
