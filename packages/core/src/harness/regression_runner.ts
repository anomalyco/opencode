export * as RegressionRunner from "./regression_runner"

import { Context, Effect, Layer, Schema } from "effect"
import { LLM, LLMError } from "@opencode-ai/llm"
import { Database } from "../database/database"
import { HarnessVersion } from "./version"
import { makeLocationNode } from "../effect/app-node"
import {
  harness_task,
  harness_subtask_feedback,
  harness_version,
  harness_regression_result,
} from "./schema"
import { eq, and, inArray } from "drizzle-orm"

// Minimum pass rate required for a candidate to be promoted
const PASS_RATE_THRESHOLD = 0.8

export const RegressionTaskResult = Schema.Struct({
  taskID: Schema.String,
  taskPrompt: Schema.String,
  passed: Schema.Boolean,
  score: Schema.Number,
  reasoning: Schema.String,
}).annotate({ identifier: "RegressionRunner.RegressionTaskResult" })
export type RegressionTaskResult = typeof RegressionTaskResult.Type

export const RegressionSummary = Schema.Struct({
  versionID: Schema.String,
  totalTasks: Schema.Number,
  passedTasks: Schema.Number,
  passRate: Schema.Number,
  promoted: Schema.Boolean,
  results: Schema.Array(RegressionTaskResult),
}).annotate({ identifier: "RegressionRunner.RegressionSummary" })
export type RegressionSummary = typeof RegressionSummary.Type

export interface Interface {
  readonly runRegressionForCandidate: (versionID: string, model: unknown) => Effect.Effect<RegressionSummary, LLMError>
  readonly getRegressionSummary: (versionID: string) => Effect.Effect<RegressionSummary>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RegressionRunner") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const versionSvc = yield* HarnessVersion.Service

    // -------------------------------------------------------------------------
    // Run dry-eval regression for a staged candidate version.
    //
    // Strategy:
    //   1. Mark candidate as "testing" in DB.
    //   2. Load all held-in tasks for the candidate's domain (completed or failed).
    //   3. For each task, rebuild the stored trace from harness_subtask_feedback.
    //   4. Run JudgeAgent-style LLM evaluation against the stored trace.
    //   5. Record each result into harness_regression_result.
    //   6. Check promotion conditions: passRate >= threshold AND no regressions.
    //   7. Atomically promote or reject the candidate.
    // -------------------------------------------------------------------------
    const runRegressionForCandidate = Effect.fn("RegressionRunner.runRegressionForCandidate")(function* (
      versionID: string,
      model: unknown,
    ) {
      // 1. Load the candidate version
      const candidate = yield* db
        .select()
        .from(harness_version)
        .where(eq(harness_version.version_id, versionID))
        .get()
        .pipe(Effect.orDie)

      if (!candidate) return yield* Effect.die(`RegressionRunner: version not found: ${versionID}`)

      // Mark as "testing" so the system knows evaluation is in progress
      yield* db
        .update(harness_version)
        .set({ status: "testing" })
        .where(eq(harness_version.version_id, versionID))
        .run()
        .pipe(Effect.orDie)

      // 2. Load held-in tasks for this domain
      const heldTasks = yield* db
        .select()
        .from(harness_task)
        .where(
          and(
            eq(harness_task.task_type, candidate.domain_category),
            inArray(harness_task.task_status, ["completed", "failed"]),
          ),
        )
        .all()
        .pipe(Effect.orElseSucceed(() => []))

      if (!heldTasks.length) {
        // No held tasks — auto-promote: no evidence of regression
        yield* versionSvc.promoteCandidate(versionID)
        return {
          versionID,
          totalTasks: 0,
          passedTasks: 0,
          passRate: 1,
          promoted: true,
          results: [],
        } satisfies RegressionSummary
      }

      // 3. Evaluate each task using stored trace from harness_subtask_feedback (concurrent)
      const taskIDs = heldTasks.map((t) => t.task_id)

      const allFeedback = yield* db
        .select()
        .from(harness_subtask_feedback)
        .where(inArray(harness_subtask_feedback.task_id, taskIDs))
        .all()
        .pipe(Effect.orElseSucceed(() => []))

      const feedbackByTask = new Map(
        allFeedback.map((fb) => [fb.task_id, allFeedback.filter((f) => f.task_id === fb.task_id)]),
      )

      const results = yield* Effect.forEach(
        heldTasks,
        (task) =>
          Effect.gen(function* () {
            const taskFeedbacks = feedbackByTask.get(task.task_id) ?? []

            const subtaskSummary = taskFeedbacks.length
              ? taskFeedbacks
                  .map(
                    (fb) =>
                      `- [${fb.is_satisfied ? "SATISFIED" : "UNSATISFIED"}] ${fb.subtask_content}\n  Output: ${fb.subtask_output ?? "N/A"}\n  Score: ${fb.quality_score ?? 0}/5`,
                  )
                  .join("\n")
              : "No explicit subtask feedback recorded."

            const evalRes = yield* LLM.generateObject({
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              model: model as Parameters<typeof LLM.generateObject>[0]["model"],
              system:
                "You are an AI Regression Evaluator. Given a task prompt and stored subtask execution outputs, assess whether the outputs meet the original task requirements. Be strict — this is a regression pass/fail gate.",
              prompt: `
Task Prompt:
${task.task_prompt ?? "Unknown task"}

Stored Subtask Execution Results:
${subtaskSummary}

Task Error (if any): ${task.task_error ?? "None"}
              `.trim(),
              schema: Schema.Struct({
                isSatisfied: Schema.Boolean,
                score: Schema.Number,
                reasoning: Schema.String,
              }),
              generation: { temperature: 0 },
            }).pipe(Effect.map((r) => r.object))

            const resultID = `reg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
            yield* db
              .insert(harness_regression_result)
              .values({
                id: resultID,
                version_id: versionID,
                task_id: task.task_id,
                passed: evalRes.isSatisfied,
                score: evalRes.score,
                reasoning: evalRes.reasoning,
              })
              .run()
              .pipe(Effect.orDie)

            return {
              taskID: task.task_id,
              taskPrompt: task.task_prompt ?? "",
              passed: evalRes.isSatisfied,
              score: evalRes.score,
              reasoning: evalRes.reasoning,
            } satisfies RegressionTaskResult
          }),
        { concurrency: 4 },
      )

      // 6. Compute pass rate and regression check
      const passedCount = results.filter((r) => r.passed).length
      const passRate = results.length > 0 ? passedCount / results.length : 1

      // Regression check: any previously-completed task that now fails is a regression
      const completedTaskIDs = new Set(
        heldTasks.filter((t) => t.task_status === "completed").map((t) => t.task_id),
      )
      const hasRegressions = results.some((r) => completedTaskIDs.has(r.taskID) && !r.passed)

      const shouldPromote = passRate >= PASS_RATE_THRESHOLD && !hasRegressions

      // 7. Atomically promote or reject
      if (shouldPromote) {
        yield* versionSvc.promoteCandidate(versionID)
      } else {
        yield* db
          .update(harness_version)
          .set({ status: "rejected" })
          .where(eq(harness_version.version_id, versionID))
          .run()
          .pipe(Effect.orDie)
      }

      return {
        versionID,
        totalTasks: results.length,
        passedTasks: passedCount,
        passRate,
        promoted: shouldPromote,
        results,
      } satisfies RegressionSummary
    })

    // -------------------------------------------------------------------------
    // Read-only: fetch stored regression results for a given version.
    // -------------------------------------------------------------------------
    const getRegressionSummary = Effect.fn("RegressionRunner.getRegressionSummary")(function* (versionID: string) {
      const rows = yield* db
        .select()
        .from(harness_regression_result)
        .where(eq(harness_regression_result.version_id, versionID))
        .all()
        .pipe(Effect.orElseSucceed(() => []))

      const passedCount = rows.filter((r) => r.passed).length
      const passRate = rows.length > 0 ? passedCount / rows.length : 0

      const results: RegressionTaskResult[] = rows.map((r) => ({
        taskID: r.task_id,
        taskPrompt: "",
        passed: r.passed ?? false,
        score: r.score ?? 0,
        reasoning: r.reasoning ?? "",
      }))

      return {
        versionID,
        totalTasks: rows.length,
        passedTasks: passedCount,
        passRate,
        promoted: false,
        results,
      } satisfies RegressionSummary
    })

    return Service.of({ runRegressionForCandidate, getRegressionSummary })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node, HarnessVersion.node] })
