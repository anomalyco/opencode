import * as Tool from "./tool"
import DESCRIPTION from "./task-parallel.txt"
import { ToolJsonSchema } from "./json-schema"
import { Session } from "@/session/session"
import { MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { TaskPromptOps } from "./task"
import { Config } from "@/config/config"
import { Effect, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"

const id = "task-parallel"

const Subtask = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the subtask" }),
  prompt: Schema.String.annotate({ description: "The subtask for the agent to perform autonomously" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this subtask" }),
})

export const Parameters = Schema.Struct({
  tasks: Schema.Array(Subtask).annotate({
    description: "2-5 independent subtasks to run in parallel",
  }),
})

export type Outcome = { description: string; state: "completed" | "error" | "cancelled"; text: string }

export function renderSummary(results: Outcome[]) {
  const lines = results.map((r) => {
    return `- ${r.description}: ${r.state.toUpperCase()}\n${r.text.split("\n").map((l) => `  ${l}`).join("\n")}`
  })
  return ["<parallel-tasks>", ...lines, "</parallel-tasks>"].join("\n")
}

export const TaskParallelTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskParallelTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (params.tasks.length === 0) {
        return yield* Effect.fail(new Error("tasks must contain at least one subtask"))
      }
      if (params.tasks.length > 5) {
        return yield* Effect.fail(new Error("tasks cannot contain more than 5 subtasks"))
      }

      const cfg = yield* config.get()
      const parent = yield* sessions.get(ctx.sessionID)
      let current = parent
      let depth = 0
      while (current.parentID) {
        depth++
        current = yield* sessions.get(current.parentID)
      }
      if (depth >= (cfg.subagent_depth ?? 1)) {
        return yield* Effect.fail(
          new Error(
            `Subagent depth limit reached (${cfg.subagent_depth ?? 1}). Increase "subagent_depth" to allow nested subagents.`,
          ),
        )
      }

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskParallelTool requires promptOps in ctx.extra"))

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant
      // Extract the parent message model here so the closures below see narrowed values.
      const parentModelID = msg.info.modelID
      const parentProviderID = msg.info.providerID

      // Resolve each subtask's agent + session up front, then run them in parallel.
      const prepared = yield* Effect.forEach(params.tasks, (task, index) =>
        Effect.gen(function* () {
          const next = yield* agent.get(task.subagent_type)
          if (!next) {
            return yield* Effect.fail(
              new Error(`Unknown agent type: ${task.subagent_type} is not a valid agent type`),
            )
          }
          const childPermission = deriveSubagentSessionPermission({
            parentSessionPermission: parent.permission ?? [],
            subagent: next,
          })
          const childToolDenies = [
            ...(next.permission.some((rule) => rule.permission === "todowrite")
              ? []
              : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
            ...(next.permission.some((rule) => rule.permission === "task")
              ? []
              : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
            ...(next.permission.some((rule) => rule.permission === id)
              ? []
              : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
          ]
          const session = yield* sessions.create({
            parentID: ctx.sessionID,
            title: task.description + ` (@${next.name} subagent)`,
            agent: next.name,
            permission: [
              ...childPermission,
              ...childToolDenies.filter(
                (deny) =>
                  !childPermission.some(
                    (rule) =>
                      rule.permission === deny.permission &&
                      rule.pattern === deny.pattern &&
                      rule.action === deny.action,
                  ),
              ),
            ],
          })
          const model = next.model ?? {
            modelID: parentModelID,
            providerID: parentProviderID,
          }
          return { index, task, next, session, model }
        }),
        { concurrency: "unbounded" },
      )

      // Run all subtasks in parallel; each drives its own subagent session to completion.
      const outcomes = yield* Effect.forEach(
        prepared,
        (p) =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(p.task.prompt)
            const result = yield* ops.prompt({
              messageID: MessageID.ascending(),
              sessionID: p.session.id,
              model: {
                modelID: p.model.modelID,
                providerID: p.model.providerID,
              },
              variant: p.next.model ? undefined : variant,
              agent: p.next.name,
              parts,
            })
            const text = result.parts.findLast((item) => item.type === "text")?.text ?? ""
            const failed = result.parts.findLast((item) => item.type === "tool" && item.state.status === "error")
            const err =
              result.info.role === "assistant" && result.info.error
                ? ("message" in result.info.error.data &&
                    typeof result.info.error.data.message === "string" &&
                    result.info.error.data.message) ||
                  result.info.error.name
                : undefined
            if (err || failed) {
              const message = err ? String(err) : "Subtask failed"
              return { description: p.task.description, state: "error" as const, text: message }
            }
            return { description: p.task.description, state: "completed" as const, text }
          }),
        { concurrency: "unbounded" },
      )

      return {
        title: `Ran ${params.tasks.length} subtasks in parallel`,
        metadata: {
          parentSessionId: ctx.sessionID,
          subtaskSessions: prepared.map((p) => p.session.id),
        },
        output: renderSummary(outcomes),
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      jsonSchema: ToolJsonSchema.fromSchema(Parameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
