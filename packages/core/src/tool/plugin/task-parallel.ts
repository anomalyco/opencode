export * as TaskParallelTool from "./task-parallel.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Agent } from "../../agent.js"
import { Config } from "../../config.js"
import { Job } from "../../job.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { SubagentCompletion } from "../../session/subagent-completion.js"
import { SubagentJob } from "../../session/subagent-job.js"

export const name = "task-parallel"

const Subtask = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 word) description of the subtask" }),
  prompt: Schema.String.annotate({ description: "The subtask for the agent to perform autonomously" }),
  agent: Schema.String.annotate({ description: "The type of specialized agent to use for this subtask" }),
})

export const Input = Schema.Struct({
  tasks: Schema.Array(Subtask).annotate({
    description: "2-5 independent subtasks to run concurrently",
  }),
})

const Result = Schema.Struct({
  description: Schema.String,
  sessionID: SessionSchema.ID,
  status: Schema.Literals(["completed", "error", "cancelled", "running"]),
  output: Schema.String,
})

export const Output = Schema.Struct({
  results: Schema.Array(Result),
})

export type Result = Schema.Schema.Type<typeof Result>

export const description = [
  "Run 2-5 independent subtasks concurrently, each in its own subagent session.",
  "Use only when the subtasks do not depend on each other and can run at the same time.",
  "Returns one combined summary. A failing subtask is reported as an error while the others still complete.",
].join("\n")

export function renderSummary(results: readonly Result[]) {
  return [
    "<parallel-tasks>",
    ...results.map((result) => {
      const body = result.output
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")
      return `- ${result.description} [${result.status}] (sessionID: ${result.sessionID})\n${body}`
    }),
    "</parallel-tasks>",
  ].join("\n")
}

export const Plugin = {
  id: "opencode.tool.task-parallel",
  effect: Effect.fn("TaskParallelTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const subagents = yield* SubagentJob.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.tasks.length < 2)
                return yield* new ToolFailure({ message: "task-parallel requires at least 2 subtasks" })
              if (input.tasks.length > 5)
                return yield* new ToolFailure({ message: "task-parallel accepts at most 5 subtasks" })

              const parent = yield* sessions
                .get(context.sessionID)
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                  ),
                )
              let current = parent
              let depth = 0
              while (current.parentID) {
                depth++
                current = yield* sessions
                  .get(current.parentID)
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${current.parentID}`, error }),
                    ),
                  )
              }
              const limit = Config.latest(yield* config.entries(), "experimental")?.subagent_depth ?? 1
              if (depth >= limit)
                return yield* new ToolFailure({
                  message: `Subagent depth limit reached (${limit}). Increase "experimental.subagent_depth" to allow nested subagents.`,
                })

              const prepared = yield* Effect.forEach(
                input.tasks,
                (task) =>
                  Effect.gen(function* () {
                    const agent = yield* agents.resolve(task.agent)
                    if (agent === undefined)
                      return yield* new ToolFailure({ message: `Unknown agent: ${task.agent}` })
                    if (agent.mode === "primary")
                      return yield* new ToolFailure({ message: `Agent ${task.agent} cannot run as a subagent` })
                    yield* permission
                      .assert({
                        action: name,
                        resources: [agent.id],
                        save: [agent.id],
                        sessionID: context.sessionID,
                        agent: context.agent,
                        source: {
                          type: "tool",
                          messageID: context.messageID,
                          id: context.id,
                        },
                      })
                      .pipe(
                        Effect.mapError(
                          (error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error }),
                        ),
                      )

                    const model = agent.model ?? parent.model
                    const child = yield* sessions
                      .create({
                        parentID: context.sessionID,
                        title: task.description,
                        agent: Agent.ID.make(task.agent),
                        model,
                      })
                      .pipe(
                        Effect.mapError(
                          (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                        ),
                      )
                    yield* context.progress({ sessionID: child.id, status: "running" })
                    yield* sessions
                      .prompt({
                        sessionID: child.id,
                        text: ["You are a subagent spawned by another session.", task.prompt].join("\n"),
                        resume: false,
                      })
                      .pipe(
                        Effect.mapError(
                          (error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error }),
                        ),
                      )

                    const recovery = {
                      kind: "subagent" as const,
                      parentSessionID: context.sessionID,
                      childSessionID: child.id,
                      agent: agent.name,
                      description: task.description,
                    }
                    yield* subagents.start(recovery)
                    return { task, child, agent }
                  }),
                { concurrency: "unbounded" },
              )

              const results = yield* Effect.forEach(
                prepared,
                (item) =>
                  jobs.block({ id: item.child.id, sessionID: context.sessionID }).pipe(
                    Effect.match({
                      onSuccess: (result): Result => {
                        if (result?.type === "backgrounded") {
                          return {
                            description: item.task.description,
                            sessionID: item.child.id,
                            status: "running",
                            output: `The subagent is still running in the background (sessionID: ${item.child.id}).`,
                          }
                        }
                        if (result?.info.status === "error") {
                          return {
                            description: item.task.description,
                            sessionID: item.child.id,
                            status: "error",
                            output: result.info.error ?? "Subtask failed",
                          }
                        }
                        if (result?.info.status === "cancelled") {
                          return {
                            description: item.task.description,
                            sessionID: item.child.id,
                            status: "cancelled",
                            output: "Subtask cancelled",
                          }
                        }
                        return {
                          description: item.task.description,
                          sessionID: item.child.id,
                          status: "completed",
                          output: result?.info.output ?? SubagentCompletion.NO_TEXT,
                        }
                      },
                      onFailure: (): Result => ({
                        description: item.task.description,
                        sessionID: item.child.id,
                        status: "error",
                        output: "Subtask failed",
                      }),
                    }),
                  ),
                { concurrency: "unbounded" },
              )

              return {
                output: { results },
                content: renderSummary(results),
                metadata: { subtaskSessions: prepared.map((item) => item.child.id) },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
