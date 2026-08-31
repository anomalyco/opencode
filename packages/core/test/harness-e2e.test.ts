import { describe, expect, mock } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { eq, desc } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { HarnessVersion } from "@opencode-ai/core/harness/version"
import { PromptFinalizer } from "@opencode-ai/core/harness/improving_prompt_finalizer"
import { RegressionRunner } from "@opencode-ai/core/harness/regression_runner"
import { FeedbackAgent } from "@opencode-ai/core/harness/feedback"
import { JudgeAgent } from "@opencode-ai/core/harness/judge"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { HarnessPlugin } from "@opencode-ai/core/harness/plugin"
import { ExtractedRulesSchema, EvolvedStrategy } from "@opencode-ai/core/harness/improving_prompt_finalizer"
import { harness_subtask_feedback, harness_task, harness_version } from "@opencode-ai/core/harness/schema"
import { testEffect } from "./lib/effect"
import { Schema } from "effect"

class MockLLMClientService extends Context.Service<MockLLMClientService, {
  prepare: (req: unknown) => Effect.Effect<unknown>
  stream: (req: unknown) => Effect.Effect<unknown>
  generate: (req: unknown) => Effect.Effect<unknown>
}>()("@opencode/LLMClient") {}

// Mock LLM generation to test realistic EvolvedStrategy generation
void mock.module("@opencode-ai/llm", () => ({
  LLM: {
    generateObject: () =>
      Effect.succeed({
        object: {
          taskCategory: "coding",
          refinedSystemPrompt: "Evolved prompt: Always write strict, production-quality TypeScript code.",
          extractedRules: [
            "Use strict TypeScript types without any.",
            "Write modular, single-responsibility functions.",
            "Include end-to-end regression verification.",
          ],
          temperature: 0.2,
          maxOutputTokens: 4096,
          improvementSummary: "Optimized prompt for higher code quality and strict typing.",
        },
      }),
  },
  LLMClient: {
    Service: MockLLMClientService,
    generate: () =>
      Effect.succeed({
        toolCalls: [],
        events: [],
      }),
  },
  LLMError: class LLMError extends Error {},
}))

const fakeLLMClientNode = makeGlobalNode({
  service: MockLLMClientService,
  layer: Layer.succeed(
    MockLLMClientService,
    MockLLMClientService.of({
      prepare: () => Effect.succeed({}),
      stream: () => Effect.succeed({}),
      generate: () => Effect.succeed({ toolCalls: [], events: [] }),
    }),
  ),
  deps: [],
})

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
              totalTasks: 1,
              passedTasks: 1,
              passRate: 1,
              promoted: true,
              results: [
                {
                  taskID: "task_e2e_001",
                  taskPrompt: "Implement 2-sum algorithm in TypeScript",
                  passed: true,
                  score: 5,
                  reasoning: "Task passed all criteria.",
                },
              ],
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
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      HarnessVersion.node,
      FeedbackAgent.node,
      PromptFinalizer.node,
      JudgeAgent.node,
    ]),
    [
      [RegressionRunner.node, fakeRegressionNode],
      [LayerNodePlatform.llmClient, fakeLLMClientNode],
    ],
  ),
)

describe("Harness End-to-End Runtime Pipeline", () => {
  it.effect("executes complete flow: task -> feedback -> finalizeAndEvolve -> proposeCandidate -> db.insert -> readback", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const versionSvc = yield* HarnessVersion.Service
      const finalizer = yield* PromptFinalizer.Service
      const feedbackSvc = yield* FeedbackAgent.Service

      // 1. Initial State: active v1 version
      yield* db
        .insert(harness_version)
        .values({
          version_id: "ver_initial_v1",
          domain_category: "coding",
          version_number: 1,
          system_prompt: "Initial baseline prompt for coding tasks.",
          extracted_rules: ["Write clean code."],
          status: "active",
          is_active: true,
          created_at: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)

      // 2. AI Task completion
      const taskID = "task_e2e_001"
      yield* db
        .insert(harness_task)
        .values({
          task_id: taskID,
          task_prompt: "Implement 2-sum algorithm in TypeScript",
          task_type: "coding",
          task_status: "completed",
          task_sub_status: "in_progress",
          session_id: "session_e2e_001",
        })
        .run()
        .pipe(Effect.orDie)

      // 3. User provides 'Yes' feedback
      yield* feedbackSvc.recordFeedback({
        taskID,
        sessionID: "session_e2e_001",
        feedbacks: [
          {
            subtaskContent: "Overall task completion",
            subtaskPrompt: "Implement 2-sum algorithm in TypeScript",
            subtaskOutput: "User confirmed satisfaction.",
            quality_score: 5,
            isSatisfied: true,
            userFeedback: "Yes",
            changesRequested: undefined,
          },
        ],
      })

      // Verify feedback was persisted in harness_subtask_feedback
      const storedFeedbacks = yield* db
        .select()
        .from(harness_subtask_feedback)
        .where(eq(harness_subtask_feedback.task_id, taskID))
        .all()
        .pipe(Effect.orDie)

      expect(storedFeedbacks).toHaveLength(1)
      expect(storedFeedbacks[0].user_feedback).toBe("Yes")
      expect(storedFeedbacks[0].is_satisfied).toBe(true)

      // 4. finalizeAndEvolve() runs
      const finalizerResult = yield* finalizer.finalizeAndEvolve(taskID, {})

      expect(finalizerResult).toBeDefined()
      expect(finalizerResult.candidateVersionID).toBeDefined()
      expect(finalizerResult.candidateVersionID.startsWith("ver_")).toBe(true)
      expect(finalizerResult.promoted).toBe(true)

      // 5. Verify directly in SQLite that harness_version row exists and is valid
      const storedVersions = yield* db
        .select()
        .from(harness_version)
        .where(eq(harness_version.domain_category, "coding"))
        .orderBy(desc(harness_version.version_number))
        .all()
        .pipe(Effect.orDie)

      expect(storedVersions).toHaveLength(2)

      const evolvedVersion = storedVersions.find(
        (v) => v.version_id === finalizerResult.candidateVersionID,
      )

      expect(evolvedVersion).toBeDefined()
      expect(evolvedVersion?.version_number).toBe(2)
      expect(evolvedVersion?.parent_version_id).toBe("ver_initial_v1")
      expect(evolvedVersion?.system_prompt).toBe(
        "Evolved prompt: Always write strict, production-quality TypeScript code.",
      )
      expect(evolvedVersion?.status).toBe("active")
      expect(evolvedVersion?.is_active).toBe(true)

      // 6. Verify getActiveVersion returns the promoted version
      const activeVersion = yield* versionSvc.getActiveVersion("coding")
      expect(activeVersion).not.toBeNull()
      expect(activeVersion?.versionID).toBe(finalizerResult.candidateVersionID)
      expect(activeVersion?.versionNumber).toBe(2)
    }),
  )

  it.effect("ExtractedRulesSchema properly decodes both real array and JSON-stringified array", () =>
    Effect.gen(function* () {
      // 1. Test decoding standard string array
      const fromArray = yield* Schema.decodeUnknownEffect(ExtractedRulesSchema)(["rule 1", "rule 2"])
      expect(Array.isArray(fromArray)).toBe(true)
      expect(fromArray).toEqual(["rule 1", "rule 2"])

      // 2. Test decoding JSON-stringified array (the exact bug case)
      const fromJsonString = yield* Schema.decodeUnknownEffect(ExtractedRulesSchema)(
        '["Keep responses concise and to the point.", "Always add unit tests."]',
      )
      expect(Array.isArray(fromJsonString)).toBe(true)
      expect(fromJsonString).toEqual([
        "Keep responses concise and to the point.",
        "Always add unit tests.",
      ])

      // 3. Test decoding full EvolvedStrategy with JSON-stringified extractedRules
      const evolvedStrategyRaw = {
        taskCategory: "coding",
        refinedSystemPrompt: "Refined prompt",
        extractedRules: '["Rule A", "Rule B"]',
        improvementSummary: "Improved prompt",
      }

      const decodedStrategy = yield* Schema.decodeUnknownEffect(EvolvedStrategy)(evolvedStrategyRaw)
      expect(Array.isArray(decodedStrategy.extractedRules)).toBe(true)
      expect(decodedStrategy.extractedRules).toEqual(["Rule A", "Rule B"])
    }),
  )

  it.effect("EvolvedStrategy and Evaluation properly decode numeric fields from strings", () =>
    Effect.gen(function* () {
      // 1. Test decoding EvolvedStrategy when LLM sends "0.3" as a string for temperature and "4096" for maxOutputTokens
      const rawEvolved = {
        taskCategory: "coding",
        refinedSystemPrompt: "Refined prompt with strict typing",
        extractedRules: ["Rule 1", "Rule 2"],
        temperature: "0.3",
        maxOutputTokens: "4096",
        improvementSummary: "Summary of improvements",
      }

      const decodedEvolved = yield* Schema.decodeUnknownEffect(EvolvedStrategy)(rawEvolved)
      expect(typeof decodedEvolved.temperature).toBe("number")
      expect(decodedEvolved.temperature).toBe(0.3)
      expect(typeof decodedEvolved.maxOutputTokens).toBe("number")
      expect(decodedEvolved.maxOutputTokens).toBe(4096)

      // 2. Test decoding Evaluation when LLM sends scores as strings
      const rawEval = {
        isSatisfied: true,
        score: "4.5",
        codeQualityScore: "5",
        originalityScore: "4",
        completenessScore: "5",
        efficiencyScore: "4",
        robustnessScore: "5",
        reasoning: "High quality output",
      }

      const decodedEval = yield* Schema.decodeUnknownEffect(JudgeAgent.Evaluation)(rawEval)
      expect(typeof decodedEval.score).toBe("number")
      expect(decodedEval.score).toBe(4.5)
      expect(typeof decodedEval.codeQualityScore).toBe("number")
      expect(decodedEval.codeQualityScore).toBe(5)
      expect(typeof decodedEval.originalityScore).toBe("number")
      expect(decodedEval.originalityScore).toBe(4)
      expect(typeof decodedEval.completenessScore).toBe("number")
      expect(decodedEval.completenessScore).toBe(5)
      expect(typeof decodedEval.efficiencyScore).toBe("number")
      expect(decodedEval.efficiencyScore).toBe(4)
      expect(typeof decodedEval.robustnessScore).toBe("number")
      expect(decodedEval.robustnessScore).toBe(5)
    }),
  )
})
