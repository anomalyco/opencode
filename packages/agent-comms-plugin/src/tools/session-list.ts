import { tool } from "@opencode-ai/plugin"
import { createOpencodeClient as createV2Client } from "@opencode-ai/sdk/v2"
import type { Database } from "bun:sqlite"
import { getRegistry, getUnreadCount } from "../db"
import { buildAgentList, permissionSummaryForAgent } from "../helpers"
import type { AgentConfig } from "../config"

type Deps = {
  client: any
  db: Database
  serverUrl: URL
  configAgents?: Record<string, AgentConfig> | (() => Record<string, AgentConfig> | undefined)
  getAgents?: () => Record<string, AgentConfig> | undefined
}

export function createSessionListTool(deps: Deps) {
  let v2client: ReturnType<typeof createV2Client> | undefined

  function getV2Client() {
    if (v2client) return v2client
    const v1client = deps.client as any
    const v1fetch = v1client._client?.getConfig?.()?.fetch ?? v1client._client?._config?.fetch
    v2client = createV2Client({
      baseUrl: "http://localhost:4096",
      fetch:
        v1fetch ??
        ((req: any) => {
          req.timeout = false
          return fetch(req)
        }),
    })
    return v2client
  }

  return tool({
    description:
      "List active sessions (excludes sub-sessions and current session). Shows session status, agent, depth, and unread message count. Optionally specify a directory to list sessions from a different project.",
    args: {
      directory: tool.schema
        .string()
        .optional()
        .describe("Project directory to list sessions from. Defaults to the current project directory."),
    },
    async execute(args, ctx) {
      const resolved =
        typeof deps.configAgents === "function" ? deps.configAgents() : (deps.configAgents ?? deps.getAgents?.())
      const agents = buildAgentList(resolved)

      const dir = args.directory || ctx.directory
      let sessions: Array<any>
      try {
        const c = getV2Client()
        if (!c?.session?.list) {
          return `Error: v2client not initialized properly. keys=${Object.keys(c ?? {}).join(",")} session=${c?.session} fetch=${typeof v1fetch}`
        }
        const res = await c.session.list({ directory: dir, roots: true })
        sessions = (res as any).data ?? res ?? []
        if (!Array.isArray(sessions)) sessions = []
      } catch (err: any) {
        return `Error listing sessions: ${err.message}\n${err.stack ?? ""}`
      }

      const otherSessions = sessions.filter((s: any) => s.id !== ctx.sessionID && !s.parentID)
      if (otherSessions.length === 0) return "No other sessions found."

      const lines = otherSessions.map((s: any) => {
        const reg = getRegistry(deps.db, s.id)
        const agentName = reg?.last_agent ?? "unknown"
        const permSummary = agentName !== "unknown" ? permissionSummaryForAgent(agentName, agents) : ""
        const depth = reg?.current_depth ?? 0
        const unread = getUnreadCount(deps.db, s.id)
        const permPart = permSummary ? ` — ${permSummary}` : ""

        let line = `- ${s.id} (agent: ${agentName}${permPart}) — "${s.title ?? "untitled"}" [depth: ${depth}]`
        if (unread > 0) line += `\n  Unread: ${unread} message(s)`
        return line
      })

      return `Found ${otherSessions.length} session(s):\n${lines.join("\n")}`
    },
  })
}
