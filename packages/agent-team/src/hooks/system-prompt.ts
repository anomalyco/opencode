import type { Orchestrator } from "../orchestrator/index.js"

export function createSystemPromptHook(orch: Orchestrator, projectRoot: string) {
  return async (input: { sessionID?: string; model: any }, output: { system: string[] }): Promise<void> => {
    const agents = orch.list().filter((a) => a.status !== "dead")
    const me = agents.find((a) => a.id === input.sessionID)
    const others = agents.filter((a) => a.id !== input.sessionID)

    const lines: string[] = []
    lines.push("## Team Context")
    if (me) {
      lines.push(`You are agent "${me.id}" with role "${me.role}" (priority: ${me.role_priority}).`)
      lines.push(`Status: ${me.status}`)
    }
    lines.push("")
    lines.push("### Team Members")
    if (others.length === 0) {
      lines.push("No other agents registered.")
    } else {
      for (const a of others) {
        lines.push(`- ${a.id} (${a.role}, status: ${a.status}, task: ${a.current_task_id ?? "none"})`)
      }
    }
    lines.push("")
    if (me) {
      lines.push("### Your Workspace")
      lines.push(`- Private: ${me.workspace_path}/scratch/`)
      lines.push(`- Worktrees: ${me.workspace_path}/.worktrees/`)
      lines.push(`- Team workspace: ${projectRoot}`)
    }
    lines.push("")
    lines.push("### Available Tools")
    lines.push("- agent_send(target, content) — send message to agent")
    lines.push("- agent_broadcast(content) — announce to all")
    lines.push("- agent_list() — see all agents")
    lines.push("- agent_delegate(target, task) — delegate task")
    lines.push("- agent_share(branch, desc) — share changes to team")
    lines.push("- agent_handoff(target, reason) — hand off task")
    lines.push("- agent_query(query) — search team memory")
    lines.push("- agent_revert(merge_commit) — undo a merge")
    lines.push("")
    lines.push("### Rules")
    lines.push("- You can only write to your own workspace and worktrees")
    lines.push("- Use agent_share to push changes to team workspace")
    lines.push("- Respect role priority in disagreements")
    lines.push("- Always send task.progress updates during long tasks")

    output.system.push(lines.join("\n"))
  }
}
