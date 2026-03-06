import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { SessionStatus } from "../session/status"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"

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
  background: z
    .boolean()
    .optional()
    .describe("When true, launch the subagent in the background and return immediately"),
})

function output(sessionID: string, text: string) {
  return [
    `task_id: ${sessionID} (for resuming to continue this task if needed)`,
    "",
    "<task_result>",
    text,
    "</task_result>",
  ].join("\n")
}

function backgroundOutput(sessionID: string) {
  return [
    `task_id: ${sessionID} (for polling this task with task_status)`,
    "state: running",
    "",
    "<task_result>",
    "Background task started. Continue your current work and call task_status when you need the result.",
    "</task_result>",
  ].join("\n")
}

function backgroundMessage(input: {
  sessionID: string
  description: string
  state: "completed" | "error"
  text: string
}) {
  const tag = input.state === "completed" ? "task_result" : "task_error"
  const title =
    input.state === "completed"
      ? `Background task completed: ${input.description}`
      : `Background task failed: ${input.description}`
  return [title, `task_id: ${input.sessionID}`, `state: ${input.state}`, `<${tag}>`, input.text, `</${tag}>`].join("\n")
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function resultTaskID(input: unknown) {
  if (!input || typeof input !== "object") return
  const taskID = Reflect.get(input, "task_id")
  if (typeof taskID === "string") return taskID
}

function polled(input: { message: MessageV2.WithParts; taskID: string }) {
  if (input.message.info.role !== "assistant") return false
  return input.message.parts.some((part) => {
    if (part.type !== "tool") return false
    if (part.tool !== "task_status") return false
    if (part.state.status !== "completed") return false
    return resultTaskID(part.state.input) === input.taskID
  })
}

async function latestUser(sessionID: string) {
  const [message] = await Session.messages({
    sessionID,
    limit: 1,
  })
  if (!message) return
  if (message.info.role !== "user") return
  return message.info.id
}

async function continueParent(input: { parentID: string; userID: string; taskID: string }) {
  const message =
    SessionStatus.get(input.parentID).type === "idle"
      ? undefined
      : await SessionPrompt.loop({
          sessionID: input.parentID,
        }).catch(() => undefined)
  if (message && polled({ message, taskID: input.taskID })) return
  if (SessionStatus.get(input.parentID).type !== "idle") return
  if ((await latestUser(input.parentID)) !== input.userID) return
  await SessionPrompt.loop({
    sessionID: input.parentID,
  })
}

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

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(params.task_id).catch(() => {})
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

      const parentModel = {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const model = agent.model ?? parentModel
      const background = params.background === true
      const metadata = {
        sessionId: session.id,
        model,
        ...(background ? { background: true } : {}),
      }

      ctx.metadata({
        title: params.description,
        metadata,
      })

      const run = async () => {
        const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)
        const result = await SessionPrompt.prompt({
          messageID: Identifier.ascending("message"),
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
        return result.parts.findLast((x) => x.type === "text")?.text ?? ""
      }

      if (background) {
        const inject = (state: "completed" | "error", text: string) =>
          SessionPrompt.prompt({
            sessionID: ctx.sessionID,
            noReply: true,
            model: {
              modelID: parentModel.modelID,
              providerID: parentModel.providerID,
            },
            agent: ctx.agent,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: backgroundMessage({
                  sessionID: session.id,
                  description: params.description,
                  state,
                  text,
                }),
              },
            ],
          })

        void run()
          .then((text) =>
            inject("completed", text)
              .then((message) =>
                continueParent({
                  parentID: ctx.sessionID,
                  userID: message.info.id,
                  taskID: session.id,
                }),
              )
              .catch(() => {}),
          )
          .catch((error) =>
            inject("error", errorText(error))
              .then((message) =>
                continueParent({
                  parentID: ctx.sessionID,
                  userID: message.info.id,
                  taskID: session.id,
                }),
              )
              .catch(() => {}),
          )

        return {
          title: params.description,
          metadata,
          output: backgroundOutput(session.id),
        }
      }

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const text = await run()

      return {
        title: params.description,
        metadata,
        output: output(session.id, text),
      }
    },
  }
})
