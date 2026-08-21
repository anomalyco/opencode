export * as PromptFinalizer from "./improving_prompt_finalizer"

import { Context, Effect, Layer, Schema } from "effect"
import { LLM, LLMError } from "@opencode-ai/llm"
import { Database } from "../database/database"
import { HarnessVersion } from "./version"
import { RegressionRunner } from "./regression_runner"
import { makeLocationNode } from "../effect/app-node"
import { harness_task, harness_subtask_feedback } from "./schema"
import { eq } from "drizzle-orm"

export const EvolvedStrategy = Schema.Struct({
  taskCategory: Schema.String,
  refinedSystemPrompt: Schema.String,
  extractedRules: Schema.Array(Schema.String),
  temperature: Schema.optional(Schema.Number),
  maxOutputTokens: Schema.optional(Schema.Number),
  modelOptions: Schema.optional(Schema.String),
  toolOverrides: Schema.optional(Schema.String),
  improvementSummary: Schema.String,
}).annotate({ identifier: "PromptFinalizer.EvolvedStrategy" })
export type EvolvedStrategy = typeof EvolvedStrategy.Type

export interface Interface {
  readonly finalizeAndEvolve: (taskID: string, model: unknown) => Effect.Effect<{ strategy: EvolvedStrategy; candidateVersionID: string; promoted: boolean }, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PromptFinalizer") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const versionSvc = yield* HarnessVersion.Service
    const regressionSvc = yield* RegressionRunner.Service

    const finalizeAndEvolve = Effect.fn("PromptFinalizer.finalizeAndEvolve")(function* (taskID: string, model: unknown) {
      // 1. Fetch task details
      const task = yield* db
        .select()
        .from(harness_task)
        .where(eq(harness_task.task_id, taskID))
        .get()
        .pipe(Effect.orDie)

      if (!task) {
        return yield* Effect.die(`Task not found: ${taskID}`)
      }

      // 2. Fetch subtask feedback records
      const feedbacks = yield* db
        .select()
        .from(harness_subtask_feedback)
        .where(eq(harness_subtask_feedback.task_id, taskID))
        .all()
        .pipe(Effect.orDie)

      const feedbackTrace = feedbacks
        .map(
          (fb) => `
Subtask: ${fb.subtask_content}
Subtask Prompt Used: ${fb.subtask_prompt ?? "N/A"}
Subtask Output Produced: ${fb.subtask_output ?? "N/A"}
Prompt Reiterated: ${fb.is_reiterated ? "YES" : "NO"} (Count: ${fb.prompt_iteration_count ?? 1})
Prompt Changed Mid-way: ${fb.is_prompt_changed ? "YES" : "NO"}
Satisfied: ${fb.is_satisfied ? "YES" : "NO"} (Rating: ${fb.quality_score ?? 0}/5)
User Feedback: ${fb.user_feedback ?? "None"}
Requested Changes: ${fb.changes_requested ?? "None"}
        `.trim(),
        )
        .join("\n---\n")

      // 3. Meta-prompt optimization via LLM
      const res = yield* LLM.generateObject({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        model: model as Parameters<typeof LLM.generateObject>[0]["model"],
        system: "You are an Expert Prompt Engineer and Harness Strategist. Analyze the prompts used, reiteration/retry patterns, subtask outputs, and user feedback to produce an evolved system prompt, tuned inference parameters, tool overrides, and strategy rules for future tasks.",
        prompt: `
Original Task Prompt:
${task.task_prompt}

Subtask Prompts, Reiteration Analysis, Outputs & User Feedback Trace:
${feedbackTrace || "No explicit subtask feedback."}

Task Error (if any):
${task.task_error ?? "None"}
        `.trim(),
        schema: EvolvedStrategy,
        generation: { temperature: 0 },
      })

      const strategy = res.object

      // 4. Save versioned candidate proposal into harness_version
      const candidateVersionID = yield* versionSvc.proposeCandidate({
        domainCategory: strategy.taskCategory || task.task_type || "general",
        systemPrompt: strategy.refinedSystemPrompt,
        extractedRules: strategy.extractedRules,
        temperature: strategy.temperature,
        maxOutputTokens: strategy.maxOutputTokens,
        modelOptions: strategy.modelOptions,
        toolOverrides: strategy.toolOverrides,
      })

      // 5. Gate promotion behind regression check (run for both satisfied and unsatisfied tasks)
      const regressionResult = yield* regressionSvc
        .runRegressionForCandidate(candidateVersionID, model)
        .pipe(Effect.orElseSucceed(() => undefined))

      const promoted = regressionResult?.promoted ?? false

      return { strategy, candidateVersionID, promoted }
    })

    return Service.of({ finalizeAndEvolve })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node, HarnessVersion.node, RegressionRunner.node] })
