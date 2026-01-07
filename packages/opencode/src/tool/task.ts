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

export { DESCRIPTION as TASK_DESCRIPTION }

export function filterSubagents(agents: Agent.Info[], ruleset: PermissionNext.Ruleset) {
  return agents.filter((a) => PermissionNext.evaluate("task", a.name, ruleset).action !== "deny")
}

type TaskMetadata = {
  sessionId: string
  async?: boolean
  summary?: { id: string; tool: string; state: { status: string; title?: string } }[]
}

export const TaskTool = Tool.define<
  z.ZodObject<{
    description: z.ZodString
    prompt: z.ZodString
    subagent_type: z.ZodString
    name: z.ZodOptional<z.ZodString>
    async: z.ZodOptional<z.ZodBoolean>
    session_id: z.ZodOptional<z.ZodString>
    command: z.ZodOptional<z.ZodString>
  }>,
  TaskMetadata
>("task", async () => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
  const description = DESCRIPTION.replace(
    "{agents}",
    agents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters: z.object({
      description: z.string().describe("A short (3-5 words) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z.string().describe("The type of specialized agent to use for this task"),
      name: z.string().describe("Human-readable task name for sidebar display").optional(),
      async: z
        .boolean()
        .describe(
          "async/background/parallel mode. MUST use when the subagent can run concurrently while you continue; MUST use for non-conflicting parallel work (e.g., multiple independent research tasks, testing different components); SHOULD use for research or long-running tasks; MUST NOT use when the result is required before the next step. Omit for blocking execution. You will be automatically notified when async tasks complete.",
        )
        .optional(),
      session_id: z.string().describe("Existing Task session to continue").optional(),
      command: z.string().describe("The command that triggered this task").optional(),
    }),
    async execute(params, ctx) {
      const config = await Config.get()

      const userInvokedAgents = (ctx.extra?.userInvokedAgents ?? []) as string[]
      if (!ctx.extra?.bypassAgentCheck && !userInvokedAgents.includes(params.subagent_type)) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
        if (params.async) {
          await ctx.ask({
            permission: "task_async",
            patterns: [params.subagent_type],
            always: ["*"],
            metadata: {
              description: params.description,
              subagent_type: params.subagent_type,
              async: true,
            },
          })
        }
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      if (params.async) {
        const limit = config.experimental?.async_task_limit ?? 3
        const running = await Session.runningChildren(ctx.sessionID)
        if (running.length >= limit) {
          throw new Error(`Maximum ${limit} concurrent async tasks reached. Wait for a task to complete.`)
        }
      }

      const taskName = params.name ?? params.description + ` (@${agent.name} subagent)`
      const basePermissions: PermissionNext.Ruleset = [
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
        {
          permission: "task",
          pattern: "*",
          action: "deny",
        },
      ]
      const primaryPermissions =
        config.experimental?.primary_tools?.map((t) => ({
          pattern: "*",
          action: "allow" as const,
          permission: t,
        })) ?? []
      const asyncConfig: Config.Permission = config.experimental?.async_task_permissions ?? {}
      const asyncPermissions = params.async
        ? PermissionNext.merge(basePermissions, PermissionNext.fromConfig(asyncConfig), primaryPermissions)
        : PermissionNext.merge(basePermissions, primaryPermissions)
      const session = await iife(async () => {
        if (params.session_id) {
          const found = await Session.get(params.session_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: taskName,
          permission: asyncPermissions,
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

      const updateSummary = (part: MessageV2.Part) => {
        if (part.type !== "tool") return
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }
      }

      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        updateSummary(evt.properties.part)

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
      if (!params.async) {
        ctx.abort.addEventListener("abort", cancel)
        using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      }
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      const promptConfig = {
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
          task: false,
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      }

      if (params.async) {
        unsub()

        const parentSessionID = ctx.sessionID
        const parentMessageID = ctx.messageID
        const parentCallID = ctx.callID
        const parentAgent = msg.info.agent
        const parentModel = { providerID: msg.info.providerID, modelID: msg.info.modelID }

        const canNotifyParent = async () => {
          if (!parentCallID) return false
          const parent = await Session.get(parentSessionID).catch(() => null)
          if (!parent) return false
          const revertId = parent.revert?.messageID
          if (revertId && parentMessageID.localeCompare(revertId) >= 0) return false
          const parentMessage = await MessageV2.get({
            sessionID: parentSessionID,
            messageID: parentMessageID,
          }).catch(() => null)
          if (!parentMessage) return false
          return parentMessage.parts.some((part) => part.type === "tool" && part.callID === parentCallID)
        }

        async function updateParentPart(summary: typeof parts) {
          if (!parentCallID) return
          const parentParts = await MessageV2.parts(parentMessageID)
          const parentPart = parentParts.find(
            (p): p is MessageV2.ToolPart => p.type === "tool" && p.callID === parentCallID,
          )
          if (!parentPart) return

          const summaryArray = Object.values(summary).sort((a, b) => a.id.localeCompare(b.id))
          const state = parentPart.state

          if (state.status === "pending") return

          await Session.updatePart({
            ...parentPart,
            state: {
              ...state,
              metadata: {
                ...(state.metadata ?? {}),
                summary: summaryArray,
                sessionId: session.id,
                async: true,
              },
            },
          })
        }

        const asyncUnsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
          if (evt.properties.part.sessionID !== session.id) return
          if (evt.properties.part.messageID === messageID) return

          const part = evt.properties.part
          if (part.type !== "tool") return

          parts[part.id] = {
            id: part.id,
            tool: part.tool,
            state: {
              status: part.state.status,
              title: part.state.status === "completed" ? part.state.title : undefined,
            },
          }
          await updateParentPart(parts)
        })

        const notifyParentOfError = async (error: unknown) => {
          asyncUnsub()
          if (ctx.abort.aborted) return
          const shouldNotify = await canNotifyParent()
          if (!shouldNotify) return

          const errMessage = error instanceof Error ? error.message : String(error)

          await SessionPrompt.prompt({
            sessionID: parentSessionID,
            agent: parentAgent,
            model: parentModel,
            noReply: false,
            parts: [
              {
                type: "subtask",
                subagentSessionID: session.id,
                description: taskName,
                status: "error",
                error: errMessage,
                prompt: params.prompt,
                agent: agent.name,
              },
            ],
          })
        }

        SessionPrompt.prompt(promptConfig)
          .then(async (result) => {
            asyncUnsub()

            const shouldNotify = await canNotifyParent()
            if (!shouldNotify) return

            await updateParentPart(parts)

            const lastText =
              ("parts" in result ? result.parts.findLast((x) => x.type === "text")?.text : undefined) ??
              "Task completed."

            const summary = lastText

            await SessionPrompt.prompt({
              sessionID: parentSessionID,
              agent: parentAgent,
              model: parentModel,
              noReply: false,
              parts: [
                {
                  type: "subtask",
                  subagentSessionID: session.id,
                  description: taskName,
                  status: "completed",
                  prompt: params.prompt,
                  agent: agent.name,
                  summary,
                },
              ],
            })
          })
          .catch(notifyParentOfError)

        return {
          title: params.description,
          metadata: {
            sessionId: session.id,
            async: true,
            summary: [],
          },
          output: `Task started in background: "${taskName}". Session: ${session.id}. You will be notified when it completes.`,
        }
      }

      const result = await SessionPrompt.prompt(promptConfig)
      unsub()

      const messages = await Session.messages({ sessionID: session.id })
      const summary = messages
        .filter((x) => x.info.role === "assistant")
        .flatMap((m) => m.parts.filter((x): x is MessageV2.ToolPart => x.type === "tool"))
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
          async: false,
        },
        output,
      }
    },
  }
})
