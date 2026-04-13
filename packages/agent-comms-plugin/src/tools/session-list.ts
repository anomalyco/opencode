import { tool } from "@opencode-ai/plugin"
import type { Database } from "bun:sqlite"
import { getRegistry, getUnreadCount } from "../db"
import { buildAgentList, permissionSummaryForAgent } from "../helpers"
import type { AgentConfig } from "../config"

type Deps = {
  client: {
    session: {
      list: (params?: { directory?: string; roots?: boolean }) => Promise<{ data: Array<any> }>
      status: (params?: { directory?: string }) => Promise<{ data: Record<string, { type: string }> }>
    }
  }
  db: Database
  configAgents?: Record<string, AgentConfig> | (() => Record<string, AgentConfig> | undefined)
  getAgents?: () => Record<string, AgentConfig> | undefined
}

export function createSessionListTool(deps: Deps) {
  return tool({
    description:
      "List active sessions in the project (excludes sub-sessions and current session). Shows session status, agent, depth, and unread message count.",
    args: {},
    async execute(_args, ctx) {
      const resolved =
        typeof deps.configAgents === "function" ? deps.configAgents() : (deps.configAgents ?? deps.getAgents?.())
      const agents = buildAgentList(resolved)

      let sessions: Array<any>
      try {
        const res = await deps.client.session.list({ directory: ctx.directory, roots: true })
        sessions = res.data ?? []
      } catch (err: any) {
        return `Error listing sessions: ${err.message}`
      }

      const otherSessions = sessions.filter((s) => s.id !== ctx.sessionID && !s.parentID)
      if (otherSessions.length === 0) return "No other sessions found."

      let statuses: Record<string, { type: string }> = {}
      try {
        const statusRes = await deps.client.session.status({ directory: ctx.directory })
        statuses = statusRes.data ?? {}
      } catch {}

      const lines = otherSessions.map((s) => {
        const reg = getRegistry(deps.db, s.id)
        const status = statuses[s.id]?.type ?? "unknown"
        const agentName = reg?.last_agent ?? "unknown"
        const permSummary = agentName !== "unknown" ? permissionSummaryForAgent(agentName, agents) : ""
        const depth = reg?.current_depth ?? 0
        const unread = getUnreadCount(deps.db, s.id)
        const permPart = permSummary ? ` — ${permSummary}` : ""

        let line = `- ${s.id} (${status}, agent: ${agentName}${permPart}) — "${s.title ?? "untitled"}" [depth: ${depth}]`
        if (unread > 0) line += `\n  Unread: ${unread} message(s)`
        return line
      })

      return `Found ${otherSessions.length} session(s):\n${lines.join("\n")}`
    },
  })
}
