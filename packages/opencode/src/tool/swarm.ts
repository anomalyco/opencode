import * as Tool from "./tool"
import DESCRIPTION from "./swarm.txt"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import { Config } from "@/config/config"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import type { TaskPromptOps } from "./task"

export const Parameters = Schema.Struct({
  task: Schema.String.annotate({ description: "The large task to distribute across the swarm" }),
  count: Schema.optional(Schema.Number).annotate({ description: "Number of workers (default 20, max 50)" }),
  agent: Schema.optional(Schema.String).annotate({
    description: "Subagent type to use for each worker (default: apex-specter)",
  }),
  instructions: Schema.optional(Schema.String).annotate({
    description: "Shared instructions appended to every worker prompt",
  }),
})

export const SwarmTool = Tool.define(
  "swarm",
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service
    const database = yield* Database.Service
    const flags = yield* RuntimeFlags.Service

    const run = Effect.fn("SwarmTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!ops) return yield* Effect.fail(new Error("SwarmTool requires promptOps in ctx.extra"))

      const count = Math.min(Math.max(1, params.count ?? 20), 50)
      const subagentType = params.agent ?? "apex-specter"
      const sharedInstructions = params.instructions ?? ""

      yield* ctx.ask({
        permission: "swarm",
        patterns: [subagentType],
        always: ["*"],
        metadata: { task: params.task, count, agent: subagentType },
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

      yield* ctx.metadata({ title: `Swarm: ${params.task}`, metadata: { count, agent: subagentType } })

      const createWorker = Effect.fn("SwarmTool.createWorker")(function* (index: number) {
        const workerSession = yield* sessions.create({
          parentID: ctx.sessionID,
          title: `Swarm worker ${index + 1}/${count} (@${next.name})`,
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
          `You are swarm worker ${index + 1} of ${count}.`,
          `Original task: ${params.task}`,
          `Your job: tackle a distinct slice of the original task. Focus on a specific sub-problem, file, module, or angle that does not overlap with the other ${count - 1} workers.`,
          sharedInstructions,
          "Return a concise final summary of what you found or produced, including file paths if you wrote code.",
        ].join("\n\n")

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
        return {
          worker: index + 1,
          sessionID: workerSession.id,
          output: result.parts.findLast((item) => item.type === "text")?.text ?? "",
        }
      })

      const workers = Array.from({ length: count }, (_, i) => i)
      const results = yield* Effect.all(workers.map(createWorker), { concurrency: "unbounded" })

      const summary = [
        `# Swarm complete: ${count} workers`,
        "",
        ...results.map((r) => `## Worker ${r.worker} (${r.sessionID})\n\n${r.output}`),
      ].join("\n\n")

      return {
        title: `Swarm: ${params.task}`,
        metadata: { count, agent: subagentType },
        output: summary,
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


