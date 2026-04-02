import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { abortAfterAny, raceSignal } from "@/util/abort"

const DEFAULT_TIMEOUT = 14_400_000 // 4 hours — zombie/stall protection, not performance pressure
const MIN_TIMEOUT = 1_800_000 // 30 minutes — floor for LLM-specified values

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  timeout: z
    .number()
    .optional()
    .describe(
      "Optional timeout in seconds for zombie/stall protection. Default: 4 hours. Minimum: 30 minutes. You almost never need to set this \u2014 only override if you have a specific reason.",
    ),
})

export async function childText(
  result: Awaited<ReturnType<typeof SessionPrompt.prompt>>,
  id: string,
  opts?: { skipAbort?: boolean; parentAborted?: boolean; deadlineAborted?: boolean },
) {
  if (result.info.role !== "assistant") return ""
  const error = result.info.error
  if (error?.name === "MessageAbortedError" && !opts?.skipAbort) {
    if (opts?.deadlineAborted) return ""
    if (opts?.parentAborted) return "Task was cancelled by user."
    return [
      `WATCHDOG: Subagent session (${id}) was killed \u2014 tool execution exceeded maximum allowed duration.`,
      `task_id: ${id}`,
      "",
      "The subagent stalled (likely waiting on an external resource or internal deadlock).",
      "Recommended: retry this task with a simpler or more focused prompt.",
      "You can resume by passing the task_id above.",
    ].join("\n")
  }
  const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
  if (text) return text
  if (!error) return ""

  // The child errored with no text output. Recover substantive work from
  // the session history so the parent doesn't lose everything.
  const lines: string[] = []

  // 1. Collect completed tool outputs from the errored message itself
  for (const p of result.parts) {
    if (p.type !== "tool" || p.state.status !== "completed") continue
    lines.push(`[${p.state.title}]\n${p.state.output}`)
  }

  // 2. Walk backwards through earlier messages for the last substantive text
  if (!lines.length) {
    const msgs = await Session.messages({ sessionID: SessionID.make(id), limit: 10 })
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.info.role !== "assistant" || m.info.id === result.info.id) continue
      const prior = m.parts.findLast((x) => x.type === "text")?.text
      if (prior) {
        lines.push(prior)
        break
      }
    }
  }

  const msg = error.data && "message" in error.data ? (error.data as { message: string }).message : error.name
  const code =
    error.data && "statusCode" in error.data ? ` (status ${(error.data as { statusCode: number }).statusCode})` : ""
  const header = `ERROR: The subagent session (${id}) failed with: ${error.name}${code}\n${msg}`

  if (!lines.length) {
    return [header, "", "You can retry this task by passing the task_id above, or try a different approach."].join("\n")
  }

  return [
    "NOTE: The subagent errored after completing some work. Partial output below:",
    "",
    ...lines,
    "",
    header,
    "",
    "You can retry this task by passing the task_id above, or try a different approach.",
  ].join("\n")
}

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

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
      const hasTodoWritePermission = agent.permission.some((rule) => rule.permission === "todowrite")

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            ...(hasTodoWritePermission
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
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

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
      })

      const messageID = MessageID.ascending()

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      const cfg_timeout = config.experimental?.task_timeout
      const raw = params.timeout ? params.timeout * 1000 : (cfg_timeout ?? DEFAULT_TIMEOUT)
      // MIN_TIMEOUT guards against LLM-specified timeouts that are too short.
      // When the user explicitly configures task_timeout, they control timeout
      // policy and the floor is not applied.
      const ms = params.timeout && !cfg_timeout ? Math.max(MIN_TIMEOUT, raw) : raw
      const deadline = abortAfterAny(ms, ctx.abort)
      deadline.signal.addEventListener("abort", cancel)

      try {
        const result = await raceSignal(
          SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            tools: {
              ...(hasTodoWritePermission ? {} : { todowrite: false }),
              ...(hasTaskPermission ? {} : { task: false }),
              ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
            },
            parts: promptParts,
          }),
          deadline.signal,
          `Task exceeded ${Math.round(ms / 1000)}s deadline`,
        )

        deadline.clearTimeout()

        // Detect timeout: deadline fired but parent wasn't cancelled
        if (deadline.signal.aborted && !ctx.abort.aborted) {
          const limit = Math.round(ms / 1000)
          const partial = await childText(result, session.id, { skipAbort: true })
          const output = [
            `TIMEOUT: Task exceeded ${limit}s deadline and was cancelled.`,
            `task_id: ${session.id}`,
            "",
            ...(partial ? ["Partial output recovered from the timed-out session:", "", partial, ""] : []),
            "You can resume this task by passing the task_id above.",
            "Recommended: retry with a simpler or more focused prompt. Break large tasks into smaller sub-tasks.",
          ].join("\n")
          return {
            title: params.description,
            metadata: {
              sessionId: session.id,
              model,
            },
            output,
          }
        }

        const text = await childText(result, session.id, {
          parentAborted: ctx.abort.aborted,
          deadlineAborted: deadline.signal.aborted,
        })

        const output = [
          `task_id: ${session.id} (for resuming to continue this task if needed)`,
          "",
          "<task_result>",
          text,
          "</task_result>",
        ].join("\n")

        return {
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
          },
          output,
        }
      } catch (e) {
        deadline.clearTimeout()
        // If parent was aborted (user Ctrl+C), re-throw — don't mask it
        if (ctx.abort.aborted) throw e
        // If the deadline fired, it's a real timeout — cancel child and return structured error
        if (deadline.signal.aborted) {
          cancel()
          return {
            title: params.description,
            metadata: {
              sessionId: session.id,
              model,
            },
            output: [
              `TIMEOUT: Task exceeded ${ms / 1000}s deadline and was cancelled.`,
              `task_id: ${session.id}`,
              "",
              "You can resume this task by passing the task_id above.",
              "If this task is important, retry with a longer timeout or a simpler prompt.",
              "Recommended: retry with a simpler or more focused prompt. Break large tasks into smaller sub-tasks.",
            ].join("\n"),
          }
        }
        // Non-timeout, non-abort error — surface the actual failure
        cancel()
        const reason = e instanceof Error ? e.message : String(e)
        return {
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
          },
          output: [
            `ERROR: Task failed: ${reason}`,
            `task_id: ${session.id}`,
            "",
            "You can resume this task by passing the task_id above, or try a different approach.",
          ].join("\n"),
        }
      } finally {
        deadline.signal.removeEventListener("abort", cancel)
      }
    },
  }
})
