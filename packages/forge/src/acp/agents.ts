import type { MatchResult } from "../util/match.js"
import { fuzzyMatch } from "../util/match.js"
import { parse } from "toml"
import { readdirSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { z } from "zod"

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

// Schema for validating TOML agent definitions
const InstallCommandSchema = z.object({
  method: z.string(),
  command: z.string(),
  description: z.string().optional(),
})

const AgentTomlSchema = z.object({
  name: z.string(),
  description: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  install_guide: z.string().optional(),
  default: z.boolean().optional(),
  color: z.string().optional(),
  install_method: z.enum(["npx", "uvx", "system", "skip"]).optional(),
  install_check: z.string().optional(),
  install_commands: z
    .object({
      unix: z.array(InstallCommandSchema),
      windows: z.array(InstallCommandSchema).optional(),
    })
    .optional(),
  uninstall_commands: z
    .object({
      unix: z.array(InstallCommandSchema),
      windows: z.array(InstallCommandSchema).optional(),
    })
    .optional(),
})

/**
 * Loads all agent definitions from TOML files in the agents directory
 */
function loadAgentsFromToml(): ACPAgentDefinition[] {
  const agentsDir = join(dirname(fileURLToPath(import.meta.url)), "agents")
  const files = readdirSync(agentsDir)
  const tomlFiles = files.filter((file) => file.endsWith(".toml"))

  const agents: ACPAgentDefinition[] = []
  const errors: string[] = []

  for (const file of tomlFiles) {
    try {
      const filePath = join(agentsDir, file)
      const content = readFileSync(filePath, "utf-8")
      const parsed = parse(content)
      const validated = AgentTomlSchema.parse(parsed)

      const agent: ACPAgentDefinition = {
        name: validated.name,
        description: validated.description,
        command: validated.command,
        acpStartupArgs: validated.args,
        args: validated.args, // Alias for backward compatibility
        installGuide: validated.install_guide,
        color: validated.color,
        installMethod: validated.install_method,
        installCheck: validated.install_check,
        installCommands: validated.install_commands
          ? {
            unix: validated.install_commands.unix,
            windows: validated.install_commands.windows || [],
          }
          : {
            unix: [],
            windows: [],
          },
      }

      if (validated.uninstall_commands) {
        agent.uninstallCommands = {
          unix: validated.uninstall_commands.unix,
          windows: validated.uninstall_commands.windows || [],
        }
      }

      agents.push(agent)
    } catch (error) {
      errors.push(`Failed to load agent from ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length > 0) {
    console.warn("Some agent files failed to load:\n" + errors.join("\n"))
  }

  if (agents.length === 0) {
    throw new Error("No valid agent definitions found in agents directory")
  }

  // Sort agents by name for consistent ordering
  agents.sort((a, b) => a.name.localeCompare(b.name))

  return agents
}

// Load agents synchronously at module load time
export const ACP_AGENTS: ACPAgentDefinition[] = loadAgentsFromToml()

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
