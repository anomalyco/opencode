import { describe, expect, mock } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { HarnessVersion } from "@opencode-ai/core/harness/version"
import { PromptFinalizer } from "@opencode-ai/core/harness/improving_prompt_finalizer"
import { RegressionRunner } from "@opencode-ai/core/harness/regression_runner"
import { FeedbackAgent } from "@opencode-ai/core/harness/feedback"
import { harness_subtask_feedback, harness_task, harness_version } from "@opencode-ai/core/harness/schema"
import { testEffect } from "./lib/effect"

const prompts = ["Improved prompt one", "Improved prompt two"]
let promptIndex = 0

void mock.module("@opencode-ai/llm", () => ({
  LLM: {
    generateObject: () => Effect.succeed({ object: {
      taskCategory: "coding",
      refinedSystemPrompt: prompts[promptIndex++],
      extractedRules: ["Keep the implementation focused."],
      improvementSummary: "Improve the result.",
    } }),
  },
  LLMError: class LLMError extends Error {},
}))

const fakeRegressionNode = makeLocationNode({
  service: RegressionRunner.Service,
  layer: Layer.effect(
    RegressionRunner.Service,
    Effect.gen(function* () {
      const versionSvc = yield* HarnessVersion.Service
      return RegressionRunner.Service.of({
        runRegressionForCandidate: (versionID) =>
          versionSvc.promoteCandidate(versionID).pipe(
            Effect.map(() => ({
              versionID,
              totalTasks: 0,
              passedTasks: 0,
              passRate: 1,
              promoted: true,
              results: [],
            })),
          ),
        getRegressionSummary: () =>
          Effect.succeed({
            versionID: "",
            totalTasks: 0,
            passedTasks: 0,
            passRate: 1,
            promoted: true,
            results: [],
          }),
      })
    }),
  ),
  deps: [HarnessVersion.node],
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, HarnessVersion.node, FeedbackAgent.node, PromptFinalizer.node]), [
    [RegressionRunner.node, fakeRegressionNode],
  ]),
)

describe("Harness persistence flow", () => {
  it.effect("persists feedback and successive improved prompt versions", () =>
    Effect.gen(function* () {
      promptIndex = 0
      const { db } = yield* Database.Service
      const versionSvc = yield* HarnessVersion.Service
      const finalizer = yield* PromptFinalizer.Service
      const feedbackSvc = yield* FeedbackAgent.Service

      yield* db
        .insert(harness_version)
        .values({
          version_id: "ver_initial",
          domain_category: "coding",
          version_number: 1,
          system_prompt: "Original prompt",
          extracted_rules: ["Original rule"],
          status: "active",
          is_active: true,
          created_at: 1,
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(harness_task)
        .values({
          task_id: "task_harness_persistence",
          task_prompt: "Build the requested feature",
          task_type: "coding",
          task_status: "completed",
        })
        .run()
        .pipe(Effect.orDie)

      const recordFeedback = (feedback: string) =>
        feedbackSvc.recordFeedback({
          taskID: "task_harness_persistence",
          sessionID: "session_harness_persistence",
          feedbacks: [{
            subtaskContent: feedback,
            subtaskPrompt: "Build the requested feature",
            subtaskOutput: feedback,
            quality_score: 3,
            isSatisfied: false,
            userFeedback: feedback,
            changesRequested: feedback,
          }],
        })

      yield* recordFeedback("Add clearer error handling.")
      const first = yield* finalizer.finalizeAndEvolve("task_harness_persistence", {})

      const afterFirst = yield* db
        .select()
        .from(harness_version)
        .where(eq(harness_version.domain_category, "coding"))
        .all()
        .pipe(Effect.orDie)
      expect(afterFirst).toHaveLength(2)
      expect(afterFirst.find((row) => row.version_id === first.candidateVersionID)).toMatchObject({
        version_number: 2,
        system_prompt: "Improved prompt one",
        parent_version_id: "ver_initial",
        status: "active",
        is_active: true,
      })
      expect(afterFirst.find((row) => row.version_id === "ver_initial")).toMatchObject({
        version_number: 1,
        system_prompt: "Original prompt",
        extracted_rules: ["Original rule"],
      })

      yield* recordFeedback("Use a more concise implementation.")
      const second = yield* finalizer.finalizeAndEvolve("task_harness_persistence", {})

      const versions = yield* db
        .select()
        .from(harness_version)
        .where(eq(harness_version.domain_category, "coding"))
        .all()
        .pipe(Effect.orDie)
      const feedbacks = yield* db
        .select()
        .from(harness_subtask_feedback)
        .where(eq(harness_subtask_feedback.task_id, "task_harness_persistence"))
        .all()
        .pipe(Effect.orDie)

      expect(versions).toHaveLength(3)
      expect(versions.find((row) => row.version_id === second.candidateVersionID)).toMatchObject({
        version_number: 3,
        system_prompt: "Improved prompt two",
        parent_version_id: first.candidateVersionID,
        status: "active",
        is_active: true,
      })
      expect(versions.map((row) => row.system_prompt)).toEqual([
        "Original prompt",
        "Improved prompt one",
        "Improved prompt two",
      ])
      expect(feedbacks).toHaveLength(2)
      expect(feedbacks.map((row) => row.user_feedback)).toEqual([
        "Add clearer error handling.",
        "Use a more concise implementation.",
      ])
      expect(versionSvc).toBeDefined()
    }),
  )

})
