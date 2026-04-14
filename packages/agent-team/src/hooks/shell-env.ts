import type { Orchestrator } from "../orchestrator/index.js"

export function createShellEnvHook(orch: Orchestrator) {
  return async (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ): Promise<void> => {
    if (!input.sessionID) return
    const agent = orch.getInfo(input.sessionID)
    if (!agent) return
    output.env.AGENT_ID = agent.id
    output.env.AGENT_ROLE = agent.role
    output.env.AGENT_WORKSPACE = agent.workspace_path
    output.env.TEAM_WORKSPACE = orch.dir.replace("/.opencode/team", "")
  }
}
