import { tool } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Database } from "bun:sqlite"
import { getRegistry, upsertRegistry, insertMessage, upsertConversation } from "../db"
import { buildAgentList, permissionSummaryForAgent, formatPrompt, extractResponse } from "../helpers"
import type { AgentConfig } from "../config"
import type { PluginConfig } from "../config"

type Deps = {
  client: any
  db: Database
  config: PluginConfig
  configAgents?: Record<string, AgentConfig> | (() => Record<string, AgentConfig> | undefined)
  getAgents?: () => Record<string, AgentConfig> | undefined
}

function clientForDir(client: any, directory: string) {
  if (!directory) return client
  const v1fetch = client._client?.getConfig?.()?.fetch ?? globalThis.fetch
  return createOpencodeClient({
    baseUrl: "http://localhost:4096",
    directory,
    fetch: v1fetch,
  })
}

export function createSessionSendTool(deps: Deps) {
  return tool({
    description:
      "Send a message to another session. Can create a new session (new_session=true) or send to an existing session. Supports sync (wait=true) and async (wait=false) modes. Maintains conversation threads via conversation_id. Use directory to target a session in a different project.",
    args: {
      message: tool.schema.string().describe("The message content to send"),
      session_id: tool.schema.string().optional().describe("Target session ID (required if new_session=false)"),
      new_session: tool.schema.boolean().optional().describe("Create a new session before sending (default: false)"),
      agent: tool.schema.string().optional().describe("Agent type for new session, or override for existing session"),
      wait: tool.schema
        .boolean()
        .optional()
        .describe("Wait for response (sync) or return immediately (async). Default: true"),
      conversation_id: tool.schema
        .string()
        .optional()
        .describe("Conversation thread ID. Auto-generated if not provided."),
      directory: tool.schema
        .string()
        .optional()
        .describe("Project directory for the target session. Defaults to the current project directory."),
    },
    async execute(args, ctx) {
      const dir = args.directory || ctx.directory
      const isNew = args.new_session === true
      const isSync = args.wait !== false
      const resolved =
        typeof deps.configAgents === "function" ? deps.configAgents() : (deps.configAgents ?? deps.getAgents?.())
      const agents = buildAgentList(resolved)
      let agentNames = new Set(agents.map((a: any) => a.name))

      const fromReg = getRegistry(deps.db, ctx.sessionID)
      const currentDepth = fromReg?.current_depth ?? 0

      if (currentDepth >= deps.config.max_depth) {
        return `Error: Maximum nesting depth (${deps.config.max_depth}) reached.`
      }

      if (!isNew && args.session_id === ctx.sessionID) {
        return "Error: Cannot send message to yourself."
      }

      if (!isNew && !args.session_id) {
        return "Error: session_id is required when new_session is not true."
      }

      let targetId = args.session_id ?? ""
      const c = clientForDir(deps.client, dir)

      if (!isNew) {
        try {
          const target = await c.session.get({ sessionID: targetId, directory: dir })
          if (target.data?.parentID) {
            return "Error: Cannot send messages to sub-sessions."
          }
        } catch {
          return `Error: Session ${targetId} not found.`
        }

        if (isSync) {
          const statuses = await c.session.status({ directory: dir })
          const status = statuses.data?.[targetId]?.type
          if (status === "busy") {
            return `Error: Session ${targetId} is busy. Use wait=false for async.`
          }
        }
      }

      if (dir !== ctx.directory && deps.client?.app?.agents) {
        try {
          const res = await clientForDir(deps.client, dir).app.agents({ query: { directory: dir } })
          const remoteAgents = res.data ?? []
          agentNames = new Set(remoteAgents.map((a: any) => a.name))
        } catch {}
      }

      const resolvedAgent = args.agent && agentNames.has(args.agent) ? args.agent : "build"
      const permSummary = permissionSummaryForAgent(resolvedAgent, agents)
      const convId = args.conversation_id ?? crypto.randomUUID()
      const newDepth = isNew ? currentDepth + 1 : currentDepth

      if (isNew) {
        try {
          const created = await c.session.create({
            directory: dir,
            title: `Agent comms: ${args.message.slice(0, 50)}`,
          })
          targetId = created.data?.id
          if (!targetId) return "Error: Failed to create session."
        } catch (err: any) {
          return `Error creating session: ${err.message}`
        }
      }

      const prompt = formatPrompt({
        fromSessionId: ctx.sessionID,
        fromSessionTitle: "Current session",
        fromAgent: ctx.agent,
        toSessionId: targetId,
        toAgent: resolvedAgent,
        permissionSummary: permSummary,
        depth: newDepth,
        maxDepth: deps.config.max_depth,
        conversationId: convId,
        message: args.message,
      })

      const parts = [{ type: "text", text: prompt }]

      if (isSync) {
        let responseText = ""
        try {
          const rawClient: any = c._client
          let responseParts: Array<{ type: string; text?: string }> = []
          if (rawClient?.post) {
            const resp = await rawClient.post({
              url: `/session/${targetId}/message`,
              body: { agent: resolvedAgent, parts },
              headers: { "Content-Type": "application/json" },
              parseAs: "text",
            })
            const text = typeof resp === "string" ? resp : resp?.data
            const parsed = JSON.parse(text) as { parts?: Array<{ type: string; text?: string }> }
            responseParts = parsed?.parts ?? []
          } else {
            const resp = await c.session.prompt({
              sessionID: targetId,
              directory: dir,
              agent: resolvedAgent,
              parts,
            })
            responseParts = resp.data?.parts ?? resp.parts ?? []
          }
          responseText = extractResponse(responseParts, deps.config.include_thinking)
        } catch (err: any) {
          upsertRegistry(deps.db, targetId, { status: "crashed", last_active: Date.now() })
          return `Error: Session ${targetId} crashed: ${err.message}\n\nRetry: 0/${deps.config.max_retry} used.\nOptions:\n1. Retry: session_send(session_id="${targetId}", message="...")\n2. Undo & respawn: Use /undo on ${targetId} to revert, then session_send(new_session=true, agent="${resolvedAgent}", ...)`
        }

        upsertRegistry(deps.db, targetId, {
          current_depth: newDepth,
          last_agent: resolvedAgent,
          last_active: Date.now(),
        })
        insertMessage(deps.db, {
          conversation_id: convId,
          from_session: ctx.sessionID,
          to_session: targetId,
          content: args.message,
          timestamp: Date.now(),
          read: 1,
          reply_to: null,
          depth: newDepth,
          type: "message",
          status: "delivered",
          retry_count: 0,
          ttl: Date.now() + deps.config.message_ttl_ms,
        })
        if (responseText) {
          insertMessage(deps.db, {
            conversation_id: convId,
            from_session: targetId,
            to_session: ctx.sessionID,
            content: responseText,
            timestamp: Date.now(),
            read: 0,
            reply_to: null,
            depth: newDepth,
            type: "response",
            status: "delivered",
            retry_count: 0,
            ttl: Date.now() + deps.config.message_ttl_ms,
          })
        }
        upsertConversation(deps.db, convId, [ctx.sessionID, targetId])

        if (responseText) {
          return `Session: ${targetId} (agent: ${resolvedAgent})\nConversation: ${convId}\n\n${responseText}`
        }
        return `Session: ${targetId} (agent: ${resolvedAgent})\nConversation: ${convId}\n\nMessage delivered.`
      } else {
        try {
          await c.session.promptAsync({
            sessionID: targetId,
            directory: dir,
            agent: resolvedAgent,
            parts,
          })

          const msgId = insertMessage(deps.db, {
            conversation_id: convId,
            from_session: ctx.sessionID,
            to_session: targetId,
            content: args.message,
            timestamp: Date.now(),
            read: 0,
            reply_to: null,
            depth: newDepth,
            type: "message",
            status: "delivered",
            retry_count: 0,
            ttl: Date.now() + deps.config.message_ttl_ms,
          })
          upsertRegistry(deps.db, targetId, {
            current_depth: newDepth,
            last_agent: resolvedAgent,
            last_active: Date.now(),
          })
          upsertConversation(deps.db, convId, [ctx.sessionID, targetId])

          return `Message sent to session ${targetId} (async).\nSession: ${targetId} (agent: ${resolvedAgent})\nConversation: ${convId}\nMessage ID: ${msgId}`
        } catch (err: any) {
          return `Error sending async message: ${err.message}`
        }
      }
    },
  })
}
