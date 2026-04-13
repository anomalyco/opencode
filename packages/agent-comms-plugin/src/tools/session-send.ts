import { tool } from "@opencode-ai/plugin"
import type { Database } from "bun:sqlite"
import { getRegistry, upsertRegistry, insertMessage, upsertConversation } from "../db"
import { buildAgentList, permissionSummaryForAgent, formatPrompt, extractResponse } from "../helpers"
import type { AgentConfig } from "../config"
import type { PluginConfig } from "../config"

type Deps = {
  client: {
    session: {
      create: (params?: { directory?: string; title?: string }) => Promise<{ data: any }>
      get: (params: { sessionID: string; directory?: string }) => Promise<{ data: any }>
      prompt: (params: {
        sessionID: string
        directory?: string
        agent?: string
        parts: Array<{ type: string; text: string }>
      }) => Promise<{
        data?: { info: any; parts: Array<{ type: string; text?: string }> }
        parts?: Array<{ type: string; text?: string }>
      }>
      promptAsync: (params: {
        sessionID: string
        directory?: string
        agent?: string
        parts: Array<{ type: string; text: string }>
      }) => Promise<{ data: void }>
      status: (params?: { directory?: string }) => Promise<{ data: Record<string, { type: string }> }>
    }
  }
  db: Database
  config: PluginConfig
  configAgents?: Record<string, AgentConfig> | (() => Record<string, AgentConfig> | undefined)
  getAgents?: () => Record<string, AgentConfig> | undefined
}

export function createSessionSendTool(deps: Deps) {
  return tool({
    description:
      "Send a message to another session. Can create a new session (new_session=true) or send to an existing session. Supports sync (wait=true) and async (wait=false) modes. Maintains conversation threads via conversation_id.",
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
    },
    async execute(args, ctx) {
      const { message, session_id, new_session, agent, wait, conversation_id } = args
      const isNew = new_session === true
      const isSync = wait !== false
      const resolved =
        typeof deps.configAgents === "function" ? deps.configAgents() : (deps.configAgents ?? deps.getAgents?.())
      const agents = buildAgentList(resolved)
      const agentNames = new Set(agents.map((a) => a.name))

      const fromReg = getRegistry(deps.db, ctx.sessionID)
      const currentDepth = fromReg?.current_depth ?? 0

      if (currentDepth >= deps.config.max_depth) {
        return `Error: Maximum nesting depth (${deps.config.max_depth}) reached.`
      }

      if (!isNew && session_id === ctx.sessionID) {
        return "Error: Cannot send message to yourself."
      }

      if (!isNew && !session_id) {
        return "Error: session_id is required when new_session is not true."
      }

      let targetId = session_id ?? ""

      if (!isNew) {
        try {
          const target = await deps.client.session.get({ sessionID: targetId, directory: ctx.directory })
          if (target.data?.parentID) {
            return "Error: Cannot send messages to sub-sessions."
          }
        } catch {
          return `Error: Session ${targetId} not found.`
        }

        if (isSync) {
          const statuses = await deps.client.session.status({ directory: ctx.directory })
          const status = statuses.data?.[targetId]?.type
          if (status === "busy") {
            return `Error: Session ${targetId} is busy. Use wait=false for async.`
          }
        }
      }

      const resolvedAgent = agent && agentNames.has(agent) ? agent : "build"
      const permSummary = permissionSummaryForAgent(resolvedAgent, agents)
      const convId = conversation_id ?? crypto.randomUUID()
      const newDepth = isNew ? currentDepth + 1 : currentDepth

      if (isNew) {
        try {
          const created = await deps.client.session.create({
            directory: ctx.directory,
            title: `Agent comms: ${message.slice(0, 50)}`,
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
        message,
      })

      const parts = [{ type: "text", text: prompt }]

      if (isSync) {
        let responseText = ""
        try {
          const rawClient: any = (deps.client as any)._client
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
            const resp = await deps.client.session.prompt({
              sessionID: targetId,
              directory: ctx.directory,
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
          content: message,
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
          await deps.client.session.promptAsync({
            sessionID: targetId,
            directory: ctx.directory,
            agent: resolvedAgent,
            parts,
          })

          const msgId = insertMessage(deps.db, {
            conversation_id: convId,
            from_session: ctx.sessionID,
            to_session: targetId,
            content: message,
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
