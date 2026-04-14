import type { Orchestrator } from "../orchestrator/index.js"
import {
  isOwnWorkspace,
  isOwnWorktree,
  isOtherAgentWorkspace,
  isTeamWorkspace,
  isProtectedPath,
} from "../util/workspace.js"

const DEFAULT_DENIED_COMMANDS = ["push --force", "push -f", "reset --hard"]
const DEFAULT_PROTECTED_PATHS = [".opencode/team/", ".opencode/plugins/agent-team/"]

export function createPermissionHook(
  orch: Orchestrator,
  config?: { protectedPaths?: string[]; deniedCommands?: string[] },
) {
  const protectedPaths = config?.protectedPaths ?? DEFAULT_PROTECTED_PATHS
  const deniedCommands = config?.deniedCommands ?? DEFAULT_DENIED_COMMANDS

  return async (
    input: {
      id: string
      type: string
      pattern?: string | string[]
      sessionID: string
      messageID: string
      callID?: string
      title: string
      metadata: Record<string, unknown>
      time: { created: number }
    },
    output: { status: "ask" | "deny" | "allow" },
  ): Promise<void> => {
    const agents = orch.list()
    const agent = agents.find((a) => a.id === input.sessionID)
    if (!agent) return

    const patterns = typeof input.pattern === "string" ? [input.pattern] : input.pattern
    const targetPath = patterns?.[0]
    if (!targetPath) return

    if (input.type === "edit" || input.type === "write") {
      if (isProtectedPath(targetPath, protectedPaths)) {
        output.status = "deny"
        return
      }
      if (isOtherAgentWorkspace(targetPath, agent.id)) {
        output.status = "deny"
        return
      }
      if (
        isTeamWorkspace(targetPath, orch.dir.replace("/.opencode/team", "")) &&
        !isOwnWorktree(targetPath, agent.id)
      ) {
        output.status = "deny"
        return
      }
    }

    if (input.type === "read") {
      if (isOtherAgentWorkspace(targetPath, agent.id)) {
        output.status = "deny"
        return
      }
    }

    if (input.type === "bash") {
      const cmd = input.metadata?.command as string | undefined
      if (cmd && deniedCommands.some((dc) => cmd.includes(dc))) {
        output.status = "deny"
        return
      }
    }
  }
}
