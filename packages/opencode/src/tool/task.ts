import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { Instance } from "../project/instance"

// Track task calls per request: Map<sessionID, Map<messageID, count>>
// Budget is per-request (one "work assignment" within a session), resets on new messageID
// Note: State grows with sessions/messages but entries are small. Future optimization:
// clean up completed sessions via Session lifecycle hooks if memory becomes a concern.
const taskCallState = Instance.state(() => new Map<string, Map<string, number>>())

function getCallCount(sessionID: string, messageID: string): number {
  const sessionCounts = taskCallState().get(sessionID)
  return sessionCounts?.get(messageID) ?? 0
}

function incrementCallCount(sessionID: string, messageID: string): number {
  const state = taskCallState()
  let sessionCounts = state.get(sessionID)
  if (!sessionCounts) {
    sessionCounts = new Map()
    state.set(sessionID, sessionCounts)
  }
  const newCount = (sessionCounts.get(messageID) ?? 0) + 1
  sessionCounts.set(messageID, newCount)
  return newCount
}

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

      const targetAgent = await Agent.get(params.subagent_type)
      if (!targetAgent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      // Check if target agent has task permission configured
      const hasTaskPermission = targetAgent.permission.some((rule) => rule.permission === "task")

      // Get caller's session to check if this is a subagent calling
      const callerSession = await Session.get(ctx.sessionID)
      const isSubagent = callerSession.parentID !== undefined

      // Get caller agent info for budget check (ctx.agent is just the name)
      const callerAgentInfo = ctx.agent ? await Agent.get(ctx.agent) : undefined

      // Get config values:
      // - task_budget on CALLER: how many calls the caller can make per request
      // - callable_by_subagents on TARGET: whether target can be called by subagents
      const callerTaskBudget = (callerAgentInfo?.options?.task_budget as number) ?? 0
      const targetCallable = (targetAgent.options?.callable_by_subagents as boolean) ?? false

      // Get target's task_budget once (used for session permissions and tool availability)
      const targetTaskBudget = (targetAgent.options?.task_budget as number) ?? 0

      // Check session ownership BEFORE incrementing budget (if task_id provided)
      // This prevents "wasting" budget on invalid session resume attempts
      if (isSubagent && params.task_id) {
        const existingSession = await Session.get(params.task_id).catch(() => undefined)
        if (existingSession && existingSession.parentID !== ctx.sessionID) {
          throw new Error(
            `Cannot resume session: not a child of caller session. ` +
            `Session "${params.task_id}" is not owned by this caller.`,
          )
        }
      }

      // Enforce nested delegation controls only for subagent-to-subagent calls
      if (isSubagent) {
        // Check 1: Caller must have task_budget configured
        if (callerTaskBudget <= 0) {
          throw new Error(
            `Caller has no task budget configured. ` +
            `Set task_budget > 0 on the calling agent to enable nested delegation.`,
          )
        }

        // Check 2: Target must be callable by subagents
        if (!targetCallable) {
          throw new Error(
            `Target "${params.subagent_type}" is not callable by subagents. ` +
            `Set callable_by_subagents: true on the target agent to enable.`,
          )
        }

        // Check 3: Budget not exhausted for this request (messageID)
        const currentCount = getCallCount(ctx.sessionID, ctx.messageID)
        if (currentCount >= callerTaskBudget) {
          throw new Error(
            `Task budget exhausted (${currentCount}/${callerTaskBudget} calls). ` +
            `Return control to caller to continue.`,
          )
        }

        // Increment count after passing all checks (including ownership above)
        incrementCallCount(ctx.sessionID, ctx.messageID)
      }

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(params.task_id).catch(() => {})
          if (found) {
            // Ownership already verified above for subagents
            return found
          }
        }

        // Build session permissions
        const sessionPermissions: PermissionNext.Rule[] = [
          { permission: "todowrite", pattern: "*", action: "deny" },
          { permission: "todoread", pattern: "*", action: "deny" },
        ]

        // Deny task if: (1) target has no task_budget, OR (2) target has no task permission
        if (targetTaskBudget <= 0 || !hasTaskPermission) {
          sessionPermissions.push({ permission: "task", pattern: "*", action: "deny" })
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${targetAgent.name} subagent)`,
          permission: [
            ...sessionPermissions,
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

      const model = targetAgent.model ?? {
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

      const messageID = Identifier.ascending("message")

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
        agent: targetAgent.name,
        tools: {
          todowrite: false,
          todoread: false,
          // Disable task if: (1) target has no task_budget, OR (2) target has no task permission
          ...(targetTaskBudget <= 0 || !hasTaskPermission ? { task: false } : {}),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

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
    },
  }
})
