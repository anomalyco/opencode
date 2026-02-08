/**
 * Agent Hooks Setup
 *
 * Main entry point for setting up CLI agent lifecycle hooks.
 * Creates wrapper scripts, shell integration, and provides
 * environment variables for terminals.
 */

import * as fs from "fs"
import * as path from "path"
import {
  CLAXEDO_DIR,
  BIN_DIR,
  HOOKS_DIR,
  SHELL_DIR,
  NOTIFY_SCRIPT,
  CLAUDE_SETTINGS,
  DEFAULT_HOOK_PORT,
  type AgentEventType,
} from "./constants"
import { generateNotifyScript } from "./templates/notify"
import {
  generateClaudeWrapper,
  generateClaudeSettings,
  generateCodexWrapper,
  generateGenericWrapper,
  getWrapperAgentNames,
} from "./templates/wrappers"
import {
  generateZshrc,
  generateZshenv,
  generateBashrc,
  getShellEnvVars,
} from "./templates/shell"

export { type AgentEventType } from "./constants"

export interface SetupOptions {
  /** OpenCode server port for hook callbacks */
  port?: number
  /** Force recreation of all files even if they exist */
  force?: boolean
}

export interface TerminalEnvOptions {
  /** Tab ID in Claxedo UI */
  tabId: string
  /** PTY terminal ID */
  terminalId: string
  /** Workspace/project ID */
  workspaceId: string
  /** OpenCode server port */
  port: number
  /** User's default shell (e.g., /bin/zsh) */
  shell?: string
}

/**
 * Write a file only if content differs or force is true
 */
async function writeIfChanged(
  filePath: string,
  content: string,
  mode: number,
  force: boolean
): Promise<boolean> {
  try {
    if (!force && fs.existsSync(filePath)) {
      const existing = await fs.promises.readFile(filePath, "utf-8")
      if (existing === content) {
        return false // No changes needed
      }
    }
    await fs.promises.writeFile(filePath, content, { mode })
    return true
  } catch (error) {
    console.error(`[agent-hooks] Failed to write ${filePath}:`, error)
    throw error
  }
}

/**
 * Set up agent hooks infrastructure
 *
 * Creates:
 * - ~/.claxedo/bin/ - Wrapper scripts for each agent
 * - ~/.claxedo/hooks/ - Notify script and settings files
 * - ~/.claxedo/shell/ - Shell integration configs
 */
export async function setupAgentHooks(options: SetupOptions = {}): Promise<void> {
  const { port = DEFAULT_HOOK_PORT, force = false } = options

  console.log("[agent-hooks] Setting up agent hooks...")

  // Create directory structure
  await fs.promises.mkdir(BIN_DIR, { recursive: true, mode: 0o755 })
  await fs.promises.mkdir(HOOKS_DIR, { recursive: true, mode: 0o755 })
  await fs.promises.mkdir(SHELL_DIR, { recursive: true, mode: 0o755 })

  const notifyPath = path.join(HOOKS_DIR, NOTIFY_SCRIPT)

  // 1. Create notify script
  await writeIfChanged(notifyPath, generateNotifyScript(port), 0o755, force)

  // 2. Create Claude wrapper and settings
  await writeIfChanged(
    path.join(BIN_DIR, "claude"),
    generateClaudeWrapper(),
    0o755,
    force
  )
  await writeIfChanged(
    path.join(HOOKS_DIR, CLAUDE_SETTINGS),
    generateClaudeSettings(notifyPath),
    0o644,
    force
  )

  // 3. Create Codex wrapper
  await writeIfChanged(
    path.join(BIN_DIR, "codex"),
    generateCodexWrapper(notifyPath),
    0o755,
    force
  )

  // 4. Create generic wrappers for other agents
  const genericAgents = ["amp", "aider", "goose", "cline"]
  for (const agent of genericAgents) {
    await writeIfChanged(
      path.join(BIN_DIR, agent),
      generateGenericWrapper(agent, notifyPath),
      0o755,
      force
    )
  }

  // 5. Create shell integration files
  await writeIfChanged(
    path.join(SHELL_DIR, ".zshrc"),
    generateZshrc(),
    0o644,
    force
  )
  await writeIfChanged(
    path.join(SHELL_DIR, ".zshenv"),
    generateZshenv(),
    0o644,
    force
  )
  await writeIfChanged(
    path.join(SHELL_DIR, ".bashrc"),
    generateBashrc(),
    0o644,
    force
  )

  console.log("[agent-hooks] Setup complete")
  console.log(`[agent-hooks]   Wrappers: ${BIN_DIR}`)
  console.log(`[agent-hooks]   Hooks: ${HOOKS_DIR}`)
  console.log(`[agent-hooks]   Shell: ${SHELL_DIR}`)
}

/**
 * Get environment variables to pass to terminal PTY
 *
 * These variables enable:
 * 1. Hook callbacks to identify which tab/terminal
 * 2. Shell integration to inject wrappers into PATH
 */
export function getTerminalEnvVars(options: TerminalEnvOptions): Record<string, string> {
  const { tabId, terminalId, workspaceId, port, shell } = options

  // Get shell-specific env vars for PATH injection
  const shellEnv = shell ? getShellEnvVars(shell) : {}

  return {
    // Claxedo identifiers for hook callbacks
    CLAXEDO_TAB_ID: tabId,
    CLAXEDO_TERMINAL_ID: terminalId,
    CLAXEDO_WORKSPACE_ID: workspaceId,
    CLAXEDO_PORT: String(port),

    // Shell integration
    ...shellEnv,
  }
}

/**
 * Check if agent hooks are set up
 */
export function isSetupComplete(): boolean {
  const requiredFiles = [
    path.join(HOOKS_DIR, NOTIFY_SCRIPT),
    path.join(BIN_DIR, "claude"),
    path.join(BIN_DIR, "codex"),
    path.join(SHELL_DIR, ".zshrc"),
  ]

  return requiredFiles.every((file) => fs.existsSync(file))
}

/**
 * Clean up agent hooks (remove all created files)
 */
export async function cleanupAgentHooks(): Promise<void> {
  console.log("[agent-hooks] Cleaning up...")

  try {
    await fs.promises.rm(CLAXEDO_DIR, { recursive: true, force: true })
    console.log("[agent-hooks] Cleanup complete")
  } catch (error) {
    console.error("[agent-hooks] Cleanup failed:", error)
    throw error
  }
}

/**
 * Get the path to a wrapper script
 */
export function getWrapperPath(agent: string): string {
  return path.join(BIN_DIR, agent)
}

/**
 * Check if a specific agent wrapper exists
 */
export function hasWrapper(agent: string): boolean {
  return fs.existsSync(getWrapperPath(agent))
}

// Re-export for convenience
export { getWrapperAgentNames } from "./templates/wrappers"
export { CLAXEDO_DIR, BIN_DIR, HOOKS_DIR, SHELL_DIR } from "./constants"
