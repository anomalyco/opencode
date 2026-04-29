import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "task-tool" })

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

interface ParentContext {
  recentMessages: string[]
  fileReferences: string[]
  parentAgent: string
  taskDescription: string
}

async function extractParentContext(
  sessionID: SessionID,
  messages: MessageV2.WithParts[],
  parentAgent: string,
  taskDescription: string,
): Promise<ParentContext> {
  const recentMessages: string[] = []
  const fileReferences = new Set<string>()

  // Extract recent conversation context (last 5 messages)
  const recentMsgs = messages.slice(-5)
  for (const msg of recentMsgs) {
    if (msg.info.role === "user") {
      const textParts = msg.parts
        .filter((p): p is MessageV2.TextPart => p.type === "text" && !p.synthetic)
        .map((p) => p.text)
        .join(" ")
      if (textParts.trim()) {
        recentMessages.push(`User: ${textParts.substring(0, 200)}${textParts.length > 200 ? "..." : ""}`)
      }
    } else if (msg.info.role === "assistant") {
      const textParts = msg.parts
        .filter((p): p is MessageV2.TextPart => p.type === "text")
        .map((p) => p.text)
        .join(" ")
      if (textParts.trim()) {
        recentMessages.push(`Assistant: ${textParts.substring(0, 200)}${textParts.length > 200 ? "..." : ""}`)
      }
    }

    // Extract file references from tool calls
    for (const part of msg.parts) {
      if (part.type === "tool" && part.state.status === "completed") {
        const input = part.state.input as Record<string, unknown>
        if (input && typeof input === "object") {
          // Extract file paths from common tool parameters
          for (const key of ["filePath", "path", "file", "filename"]) {
            const value = input[key]
            if (typeof value === "string" && (value.includes("/") || value.includes("\\"))) {
              fileReferences.add(value)
            }
          }
        }
      }
    }
  }

  return {
    recentMessages,
    fileReferences: Array.from(fileReferences).slice(0, 10), // Limit to 10 files
    parentAgent,
    taskDescription,
  }
}

function formatParentContext(context: ParentContext): string {
  const parts: string[] = []

  parts.push(`## Parent Context`)
  parts.push(`- Parent Agent: ${context.parentAgent}`)
  parts.push(`- Task: ${context.taskDescription}`)

  if (context.recentMessages.length > 0) {
    parts.push(`\n## Recent Conversation`)
    for (const msg of context.recentMessages) {
      parts.push(`- ${msg}`)
    }
  }

  if (context.fileReferences.length > 0) {
    parts.push(`\n## Relevant Files`)
    for (const file of context.fileReferences) {
      parts.push(`- ${file}`)
    }
  }

  return parts.join("\n")
}

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const messageID = MessageID.ascending()

      function cancel() {
        ops.cancel(nextSession.id)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () =>
          Effect.gen(function* () {
            // Extract parent context for subagent
            let enhancedPrompt = params.prompt
            try {
              const parentMessages = yield* sessions.messages({ sessionID: ctx.sessionID, limit: 20 })
              const parentSession = yield* sessions.get(ctx.sessionID)
              const parentAgentInfo = parentSession?.agent ? yield* agent.get(parentSession.agent) : undefined
              const parentContext = yield* Effect.promise(() =>
                extractParentContext(
                  ctx.sessionID,
                  parentMessages,
                  parentAgentInfo?.name || 'unknown',
                  params.description
                )
              )
              const contextBlock = formatParentContext(parentContext)
              enhancedPrompt = `${contextBlock}\n\n${params.prompt}`
              log.info("enhanced subagent prompt with parent context", {
                sessionID: ctx.sessionID,
                subagentType: params.subagent_type,
                contextMessages: parentContext.recentMessages.length,
                contextFiles: parentContext.fileReferences.length,
              })
            } catch (err) {
              log.info("failed to extract parent context, using original prompt", { error: err })
            }

            const parts = yield* ops.resolvePromptParts(enhancedPrompt)
            const result = yield* ops.prompt({
              messageID,
              sessionID: nextSession.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              agent: next.name,
              tools: {
                ...(canTodo ? {} : { todowrite: false }),
                ...(canTask ? {} : { task: false }),
                ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
              },
              parts,
            })

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
              ].join("\n"),
            }
          }),
        () =>
          Effect.sync(() => {
            ctx.abort.removeEventListener("abort", cancel)
          }),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
