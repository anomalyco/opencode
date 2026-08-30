export * as PromptFinalizer from "./improving_prompt_finalizer"

import { Context, Effect, Layer, Schema, SchemaGetter } from "effect"
import { LLM, LLMError, LLMClient } from "@opencode-ai/llm"
import { Database } from "../database/database"
import { HarnessVersion } from "./version"
import { RegressionRunner } from "./regression_runner"
import { makeLocationNode } from "../effect/app-node"
import { LayerNodePlatform } from "../effect/app-node-platform"
import {
  FlexibleNumber,
  harness_task,
  harness_subtask_feedback,
  harness_version,
} from "./schema"
import { eq } from "drizzle-orm"

const StringToRules = Schema.String.pipe(
  Schema.decodeTo(Schema.Array(Schema.String), {
    decode: SchemaGetter.transform((raw) => {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean)
        if (typeof parsed === "string") return [parsed.trim()]
        return [raw.trim()]
      } catch {
        return raw
          .split("\n")
          .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
          .filter(Boolean)
      }
    }),
    encode: SchemaGetter.transform((arr) => JSON.stringify(arr)),
  }),
)

export const ExtractedRulesSchema = Schema.Union([
  Schema.Array(Schema.String),
  StringToRules,
])

export const EvolvedStrategy = Schema.Struct({
  taskCategory: Schema.String,
  refinedSystemPrompt: Schema.String,
  extractedRules: ExtractedRulesSchema,
  temperature: Schema.optional(FlexibleNumber),
  maxOutputTokens: Schema.optional(FlexibleNumber),
  modelOptions: Schema.optional(Schema.String),
  toolOverrides: Schema.optional(Schema.String),
  improvementSummary: Schema.String,
}).annotate({ identifier: "PromptFinalizer.EvolvedStrategy" })

export type EvolvedStrategy = typeof EvolvedStrategy.Type

export interface Interface {
  readonly finalizeAndEvolve: (
    taskID: string,
    model: unknown,
  ) => Effect.Effect<
    {
      strategy: EvolvedStrategy
      candidateVersionID: string
      promoted: boolean
    },
    LLMError
  >
}

export class Service extends Context.Service<Service, Interface>()(
  "@opencode/v2/PromptFinalizer",
) {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const versionSvc = yield* HarnessVersion.Service
    const regressionSvc = yield* RegressionRunner.Service
    // Capture the LLMClient.Service instance at layer construction time.
    // This is REQUIRED because finalizeAndEvolve is executed via bare
    // Effect.runPromise() in plugin.ts, which runs in a fresh fiber with no
    // AppRuntime context. Without this capture the dynamic `yield* LLMClient.Service`
    // inside LLM.generateObject fails with "Service not found: @opencode/LLMClient".
    const llmClient = yield* LLMClient.Service

    const finalizeAndEvolve = Effect.fn(
      "PromptFinalizer.finalizeAndEvolve",
    )(function* (taskID: string, model: unknown) {
      const task = yield* db
        .select()
        .from(harness_task)
        .where(eq(harness_task.task_id, taskID))
        .get()
        .pipe(Effect.orDie)

      if (!task) {
        return yield* Effect.die(`Task not found: ${taskID}`)
      }

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

      const activeVer = yield* versionSvc
        .getActiveVersion(task.task_type || "general")
        .pipe(Effect.orElseSucceed(() => null))

      const existingRules =
        activeVer && Array.isArray(activeVer.extractedRules)
          ? activeVer.extractedRules.filter(
              (r): r is string => typeof r === "string",
            )
          : []

      const res = yield* LLM.generateObject({
        model: model as Parameters<
          typeof LLM.generateObject
        >[0]["model"],
        system:
          "You are an Expert Prompt Engineer and Harness Strategist (Sakana AI RHI Meta-Optimizer). Analyze the task execution, user feedback, flaws, and existing rules to produce an evolved system prompt and a consolidated set of rules.\n\nCRITICAL PRUNING DIRECTIVES:\n1. Consolidate and merge overlapping lessons into a maximum of 7-10 high-impact, non-conflicting rules.\n2. Discard redundant, obsolete, or overly narrow one-off rules.\n3. Ensure temperature stays bounded between 0.0 and 1.0.\n4. extractedRules MUST be an array of strings (e.g. [\"Rule 1\", \"Rule 2\"]).",
        prompt: `
Task Domain: ${task.task_type || "general"}

Original Task Prompt:
${task.task_prompt}

Existing Domain Rules (Consolidate & Prune):
${existingRules.map((r) => `- ${r}`).join("\n") || "None"}

Subtask Execution, Outputs & User Feedback Trace:
${feedbackTrace || "No explicit subtask feedback."}

Task Evaluation & Errors (if any):
${task.task_error ?? "None"}
        `.trim(),
        schema: EvolvedStrategy,
        generation: { temperature: 0 },
      }).pipe(
        // Inject the captured LLMClient.Service so that LLMClient.generate's
        // internal `yield* LLMClient.Service` lookup succeeds even when this
        // Effect is executed via bare Effect.runPromise() in plugin.ts.
        Effect.provideService(LLMClient.Service, llmClient),
        Effect.tapError((error) =>
          Effect.sync(() => {
            const message =
              error instanceof Error
                ? error.message
                : String(error)
            const cause =
              error instanceof Error && error.cause
                ? String(error.cause)
                : "N/A"

            console.error(
              [
                "",
                "==================================================",
                "[HARNESS ERROR]",
                "Stage: LLM generation",
                `TaskID: ${taskID}`,
                `SessionID: ${task.session_id ?? "N/A"}`,
                `Error: ${message}`,
                `Cause: ${cause}`,
                "harness_version stored: NO",
                "VersionID: N/A",
                "==================================================",
                "",
              ].join("\n"),
            )
          }),
        ),
      )

      const strategy = res.object

      if (!strategy.refinedSystemPrompt.trim()) {
        return yield* Effect.die(
          `PromptFinalizer: LLM returned an empty refinedSystemPrompt for task ${taskID}`,
        )
      }

      if (!strategy.taskCategory.trim()) {
        return yield* Effect.die(
          `PromptFinalizer: LLM returned an empty taskCategory for task ${taskID}`,
        )
      }

      const candidateVersionID =
        yield* versionSvc.proposeCandidate({
          domainCategory:
            strategy.taskCategory ||
            task.task_type ||
            "general",
          systemPrompt: strategy.refinedSystemPrompt,
          extractedRules: strategy.extractedRules,
          temperature: strategy.temperature,
          maxOutputTokens: strategy.maxOutputTokens,
          modelOptions: strategy.modelOptions,
          toolOverrides: strategy.toolOverrides,
          parentVersionID: activeVer?.versionID,
        })

      const savedVersion = yield* db
        .select({
          versionID: harness_version.version_id,
          domainCategory:
            harness_version.domain_category,
          versionNumber:
            harness_version.version_number,
          systemPrompt:
            harness_version.system_prompt,
          status: harness_version.status,
        })
        .from(harness_version)
        .where(
          eq(
            harness_version.version_id,
            candidateVersionID,
          ),
        )
        .get()
        .pipe(Effect.orDie)

      if (!savedVersion) {
        return yield* Effect.die(
          `HarnessVersion persistence failed: candidate ${candidateVersionID} was not found after proposeCandidate()`,
        )
      }

      const regressionResult = yield* regressionSvc
        .runRegressionForCandidate(
          candidateVersionID,
          model,
        )
        .pipe(
          Effect.orElseSucceed(() => undefined),
        )

      const promoted =
        regressionResult?.promoted ?? false

      return {
        strategy,
        candidateVersionID,
        promoted,
      }
    })

    return Service.of({ finalizeAndEvolve })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    HarnessVersion.node,
    RegressionRunner.node,
    LayerNodePlatform.llmClient,
  ],
})