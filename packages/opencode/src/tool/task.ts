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

// Check if caller has Plan mode restrictions (edit="deny" globally)
function hasPlanRestrictions(permissions: PermissionNext.Ruleset): boolean {
  const rule = permissions.findLast((r) => r.permission === "edit" && r.pattern === "*")
  return rule?.action === "deny"
}

// Read-only bash commands allowed in Plan mode
const PLAN_BASH_WHITELIST = [
  "cat *",
  "head *",
  "tail *",
  "grep *",
  "ls *",
  "find *",
  "wc *",
  "diff *",
  "git status*",
  "git log*",
  "git diff*",
  "git show*",
  "git branch*",
  "git remote*",
  "git rev-parse*",
  "echo *",
  "pwd",
  "which *",
  "env",
  "printenv*",
]

// Build permission rules for Plan mode inheritance
function planPermissions(): PermissionNext.Ruleset {
  return [
    { permission: "edit", pattern: "*", action: "deny" as const },
    { permission: "write", pattern: "*", action: "deny" as const },
    { permission: "patch", pattern: "*", action: "deny" as const },
    { permission: "multiedit", pattern: "*", action: "deny" as const },
    { permission: "bash", pattern: "*", action: "deny" as const },
    ...PLAN_BASH_WHITELIST.map((pattern) => ({
      permission: "bash" as const,
      pattern,
      action: "allow" as const,
    })),
  ]
}

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  session_id: z.string().describe("Existing Task session to continue").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  const caller = ctx?.agent
  const accessible = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  // Security: sub-agents must inherit Plan mode restrictions
  const restricted = caller ? hasPlanRestrictions(caller.permission) : false

  const description = DESCRIPTION.replace(
    "{agents}",
    accessible
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

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

      // Force plan agent when parent has Plan mode restrictions
      let name = params.subagent_type
      if (restricted) {
        const plan = await Agent.get("plan")
        if (!plan) {
          throw new Error("Cannot spawn sub-agent from Plan mode parent - 'plan' agent is not available")
        }
        name = "plan"
      }

      const agent = await Agent.get(name)
      if (!agent) throw new Error(`Unknown agent type: ${name} is not a valid agent type`)

      const hasTask = agent.permission.some((rule) => rule.permission === "task")
      const inherited = restricted ? planPermissions() : []

      const session = await iife(async () => {
        if (params.session_id) {
          const found = await Session.get(params.session_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent${restricted ? ", Plan mode" : ""})`,
          permission: [
            { permission: "todowrite", pattern: "*", action: "deny" },
            { permission: "todoread", pattern: "*", action: "deny" },
            ...(hasTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
            ...inherited,
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

      const disabled: Record<string, boolean> = restricted
        ? { edit: false, write: false, patch: false, multiedit: false }
        : {}

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
          ...(hasTask ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          ...disabled,
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
        },
        output,
      }
    },
  }
})
