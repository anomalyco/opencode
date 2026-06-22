import * as Tool from "./tool"
import DESCRIPTION from "./swarm-loop.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import { Config } from "@/config/config"
import { BackgroundJob } from "@/background/job"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import type { TaskPromptOps } from "./task"

export const Parameters = Schema.Struct({
  task: Schema.String.annotate({ description: "The goal to achieve via continuous swarm loops" }),
  max_iterations: Schema.optional(Schema.Number).annotate({ description: "Maximum loops (default 10)" }),
  workers: Schema.optional(Schema.Number).annotate({ description: "Workers per loop (default 10)" }),
  agent: Schema.optional(Schema.String).annotate({
    description: "Subagent type for workers (default: apex-forge)",
  }),
})

export const SwarmLoopTool = Tool.define(
  "swarm_loop",
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service
    const database = yield* Database.Service

    const run = Effect.fn("SwarmLoopTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!ops) return yield* Effect.fail(new Error("SwarmLoopTool requires promptOps in ctx.extra"))

      const maxIterations = Math.min(Math.max(1, params.max_iterations ?? 10), 50)
      const workers = Math.min(Math.max(1, params.workers ?? 10), 50)
      const subagentType = params.agent ?? "apex-forge"

      yield* ctx.ask({
        permission: "swarm_loop",
        patterns: [subagentType],
        always: ["*"],
        metadata: { task: params.task, maxIterations, workers, agent: subagentType },
      })

      const next = yield* agent.get(subagentType)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${subagentType} is not a valid agent type`))
      }

      const parent = yield* sessions.get(ctx.sessionID)
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
        ...(cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []),
      ]

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant
      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      yield* ctx.metadata({ title: `SwarmLoop: ${params.task}`, metadata: { workers, agent: subagentType } })

      let plan = `Initial plan: break down "${params.task}" into ${workers} parallel work items and execute them.`
      let previousResults: string[] = []
      let completed = false

      const createWorker = Effect.fn("SwarmLoopTool.createWorker")(function* (index: number, iteration: number) {
        const workerSession = yield* sessions.create({
          parentID: ctx.sessionID,
          title: `SwarmLoop iter ${iteration} worker ${index + 1}/${workers} (@${next.name})`,
          agent: next.name,
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        })

        const workerPrompt = [
          `You are swarm-loop worker ${index + 1} of ${workers} in iteration ${iteration}.`,
          `Goal: ${params.task}`,
          `Current plan: ${plan}`,
          previousResults.length ? `Previous iteration results:\n${previousResults.join("\n---\n")}` : "",
          `Your job: execute a distinct slice of the current plan. If the goal is already achieved, state "DONE" and summarize. Otherwise, produce the next concrete increment and report what remains.`,
          "Return a concise final summary of what you did and whether the overall goal is complete.",
        ].filter(Boolean).join("\n\n")

        const parts = yield* ops.resolvePromptParts(workerPrompt)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: workerSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant: next.model ? undefined : variant,
          agent: next.name,
          parts,
        })
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        const indices = Array.from({ length: workers }, (_, i) => i)
        const results = yield* Effect.all(indices.map((i) => createWorker(i, iteration)), { concurrency: "unbounded" })
        previousResults = results

        const allDone = results.every((r) => r.toUpperCase().includes("DONE"))
        if (allDone) {
          completed = true
          break
        }

        const reviewSession = yield* sessions.create({
          parentID: ctx.sessionID,
          title: `SwarmLoop reviewer iter ${iteration} (@apex-arbiter)`,
          agent: "apex-arbiter",
          permission: childPermission,
        })

        const reviewPrompt = [
          `Goal: ${params.task}`,
          `Iteration ${iteration} results:\n${results.join("\n---\n")}`,
          "As Apex Arbiter, synthesize these results, decide whether the goal is complete, and produce an updated plan for the next iteration. If complete, say DONE and summarize.",
        ].join("\n\n")

        const reviewParts = yield* ops.resolvePromptParts(reviewPrompt)
        const reviewResult = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: reviewSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant,
          agent: "apex-arbiter",
          parts: reviewParts,
        })
        const reviewText = reviewResult.parts.findLast((item) => item.type === "text")?.text ?? ""

        if (reviewText.toUpperCase().includes("DONE")) {
          completed = true
          previousResults.push(`Arbiter final review: ${reviewText}`)
          break
        }

        plan = reviewText
      }

      const finalSummary = [
        `# SwarmLoop complete`,
        `Completed: ${completed}`,
        "",
        "## Final results",
        previousResults.join("\n\n---\n\n"),
      ].join("\n\n")

      return {
        title: `SwarmLoop: ${params.task}`,
        metadata: { completed, workers, agent: subagentType },
        output: finalSummary,
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)


