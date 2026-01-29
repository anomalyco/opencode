import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import * as A2A from "../a2a"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "task.remote" })

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  session_id: z.string().describe("Existing Task session to continue").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Check if this is a remote agent reference
      const remoteRef = A2A.parseAgentRef(params.subagent_type)
      if (remoteRef) {
        return executeRemoteAgent(params, ctx, params.subagent_type)
      }

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      const session = await iife(async () => {
        if (params.session_id) {
          const found = await Session.get(params.session_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
        },
      })

      const messageID = Identifier.ascending("message")
      const parts: Record<string, { id: string; tool: string; state: { status: string; title?: string } }> = {}
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        if (evt.properties.part.type !== "tool") return
        const part = evt.properties.part
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }
        ctx.metadata({
          title: params.description,
          metadata: {
            summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
            sessionId: session.id,
          },
        })
      })

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          ...(hasTaskPermission ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })
      unsub()
      const messages = await Session.messages({ sessionID: session.id })
      const summary = messages
        .filter((x) => x.info.role === "assistant")
        .flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
        .map((part) => ({
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }))
      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const output = text + "\n\n" + ["<task_metadata>", `session_id: ${session.id}`, "</task_metadata>"].join("\n")

      return {
        title: params.description,
        metadata: {
          summary,
          sessionId: session.id,
          remote: undefined as { domain: string; agent: string } | undefined,
        },
        output,
      }
    },
  }
})

async function executeRemoteAgent(params: z.infer<typeof parameters>, ctx: Tool.Context, agentRef: string) {
  const parsed = A2A.parseAgentRef(agentRef)
  if (!parsed) throw new Error(`Invalid agent reference: ${agentRef}`)

  const { domain } = parsed

  // Check trust
  const isTrusted = await A2A.isTrusted(domain)
  if (!isTrusted) {
    await ctx.ask({
      permission: "remote_agent",
      patterns: [domain],
      always: [],
      metadata: {
        domain,
        description: params.description,
      },
    })
    A2A.trustForSession(domain)
  }

  // Fetch agent card
  const agentCard = await A2A.fetchAgentCard(agentRef)
  const agentDomain = A2A.getDomainFromAgentUrl(agentCard.url)

  // Check if OAuth is required and get access token
  let accessToken: string | undefined
  if (A2A.requiresOAuth(agentCard)) {
    const oauthConfig = A2A.getOAuthConfig(agentCard)
    if (oauthConfig) {
      // Check if we already have valid tokens
      const hasValidTokens = await A2A.hasValidTokens(agentDomain)
      if (!hasValidTokens) {
        // Prepare OAuth flow to get authorization URL before asking for permission
        const preparedFlow = await A2A.prepareOAuthFlow(agentDomain, oauthConfig)

        // Prompt user with the authorization URL visible
        await ctx.ask({
          permission: "a2a_oauth",
          patterns: [agentDomain],
          always: [],
          metadata: {
            domain: agentDomain,
            agent: agentCard.name,
            authorizationUrl: preparedFlow.authorizationUrl,
          },
        })

        // After approval, execute the OAuth flow (opens browser and waits for callback)
        const result = await A2A.executeOAuthFlow(agentDomain, oauthConfig, preparedFlow)
        accessToken = result.accessToken
      } else {
        // Have valid tokens, just get them
        accessToken = await A2A.getAccessToken(agentDomain, oauthConfig)
      }
    }
  }

  // Create session for tracking
  const session = await Session.create({
    parentID: ctx.sessionID,
    title: `${params.description} (@${agentRef.slice(1)} remote)`,
    permission: [],
  })

  ctx.metadata({
    title: params.description,
    metadata: {
      sessionId: session.id,
      remote: { domain: agentDomain, agent: agentCard.name },
    },
  })

  const messageID = Identifier.ascending("message")

  // Get existing contextId for conversation continuity
  const existingContextId = A2A.getContextId(ctx.sessionID, agentDomain)

  // Create assistant message
  const assistantMsg: MessageV2.Assistant = {
    id: messageID,
    sessionID: session.id,
    role: "assistant",
    time: { created: Date.now() },
    parentID: ctx.messageID,
    modelID: "remote",
    providerID: agentDomain,
    mode: "remote",
    agent: `${agentDomain}:${agentCard.name}`,
    path: {
      cwd: Instance.worktree,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
  await Session.updateMessage(assistantMsg)

  // Build A2A message
  const a2aMessage: A2A.Message = {
    kind: "message",
    messageId: crypto.randomUUID(),
    role: "user",
    parts: [{ kind: "text", text: params.prompt }],
  }

  let currentTextPart: MessageV2.TextPart | undefined
  const toolParts = new Map<string, MessageV2.ToolPart>()
  const toolSummary: Array<{ id: string; tool: string; state: { status: string; title?: string } }> = []
  let savedContextId: string | undefined

  // Stream the response
  log.info("starting stream", { agentDomain, existingContextId })
  for await (const event of A2A.streamMessage({
    agentCard,
    message: a2aMessage,
    contextId: existingContextId,
    signal: ctx.abort,
    accessToken,
  })) {
    log.info("event received", { type: event.type, event })
    switch (event.type) {
      case "task": {
        log.info("task event", { contextId: event.task.contextId, status: event.task.status, artifacts: event.task.artifacts })
        if (event.task.contextId && !savedContextId) {
          savedContextId = event.task.contextId
          A2A.setContextId(ctx.sessionID, agentDomain, event.task.contextId)
        }
        break
      }

      case "statusUpdate": {
        log.info("statusUpdate event", { state: event.state, message: event.message })
        if (event.contextId && !savedContextId) {
          savedContextId = event.contextId
          A2A.setContextId(ctx.sessionID, agentDomain, event.contextId)
        }

        if (event.message && event.state === "working") {
          const toolMatch = event.message.match(/Calling tool: (.+)/)
          if (toolMatch) {
            const toolName = toolMatch[1]
            const partId = Identifier.ascending("part")
            const part: MessageV2.ToolPart = {
              id: partId,
              messageID,
              sessionID: session.id,
              type: "tool",
              callID: `remote_${partId}`,
              tool: toolName,
              state: {
                status: "running",
                input: {},
                time: { start: Date.now() },
              },
            }
            toolParts.set(toolName, part)
            await Session.updatePart(part)

            toolSummary.push({
              id: part.id,
              tool: toolName,
              state: { status: "running" },
            })
            ctx.metadata({
              title: params.description,
              metadata: {
                summary: [...toolSummary],
                sessionId: session.id,
                remote: { domain: agentDomain, agent: agentCard.name },
              },
            })
          }
        }
        break
      }

      case "artifact": {
        log.info("artifact event", { name: event.artifact.name, partsCount: event.artifact.parts?.length, artifact: event.artifact })
        if (event.contextId && !savedContextId) {
          savedContextId = event.contextId
          A2A.setContextId(ctx.sessionID, agentDomain, event.contextId)
        }

        const artifact = event.artifact
        const artifactText = artifact.parts
          .filter((p): p is A2A.TextPart => p.kind === "text")
          .map((p) => p.text)
          .join("")
        log.info("artifact text extracted", { textLength: artifactText.length, preview: artifactText.substring(0, 200) })

        if (artifact.name === "response") {
          log.info("processing response artifact", { textLength: artifactText.length })
          if (!currentTextPart) {
            currentTextPart = {
              id: Identifier.ascending("part"),
              messageID,
              sessionID: session.id,
              type: "text",
              text: artifactText,
              time: { start: Date.now() },
            }
            await Session.updatePart({ part: currentTextPart, delta: artifactText })
          } else {
            currentTextPart.text += artifactText
            await Session.updatePart({ part: currentTextPart, delta: artifactText })
          }
        } else if (artifact.name) {
          log.info("non-response artifact", { name: artifact.name })
          // Tool output
          const existingPart = toolParts.get(artifact.name)
          if (existingPart && existingPart.state.status === "running") {
            existingPart.state = {
              status: "completed",
              input: existingPart.state.input,
              output: artifactText,
              title: "Completed",
              metadata: {},
              time: { start: existingPart.state.time.start, end: Date.now() },
            }
            await Session.updatePart(existingPart)

            const summaryIdx = toolSummary.findIndex((t) => t.id === existingPart.id)
            if (summaryIdx >= 0) {
              toolSummary[summaryIdx].state = { status: "completed", title: "Completed" }
              ctx.metadata({
                title: params.description,
                metadata: {
                  summary: [...toolSummary],
                  sessionId: session.id,
                  remote: { domain: agentDomain, agent: agentCard.name },
                },
              })
            }
          }
        }
        break
      }

      case "error": {
        log.error("error event", { message: event.message, code: event.code })
        throw new Error(`Remote agent error: ${event.message} (${event.code})`)
      }

      case "message": {
        log.info("message event", { textPreview: event.text?.substring(0, 200) })
        break
      }
    }
  }

  log.info("stream ended", { hasTextPart: !!currentTextPart, textLength: currentTextPart?.text?.length ?? 0 })

  if (currentTextPart && currentTextPart.time) {
    currentTextPart.time.end = Date.now()
    await Session.updatePart({ part: currentTextPart, delta: "" })
  }

  assistantMsg.time.completed = Date.now()
  await Session.updateMessage(assistantMsg)

  const text = currentTextPart?.text ?? ""
  log.info("returning output", { textLength: text.length, preview: text.substring(0, 100) })
  const output =
    text +
    "\n\n" +
    ["<task_metadata>", `session_id: ${session.id}`, `remote: ${agentDomain}/${agentCard.name}`, "</task_metadata>"].join("\n")

  return {
    title: params.description,
    metadata: {
      summary: toolSummary.map((t) => ({
        id: t.id,
        tool: t.tool,
        state: { status: t.state.status as string, title: t.state.title },
      })),
      sessionId: session.id,
      remote: { domain: agentDomain, agent: agentCard.name } as { domain: string; agent: string } | undefined,
    },
    output,
  }
}
