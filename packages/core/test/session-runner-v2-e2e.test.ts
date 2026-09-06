import { describe, expect } from "bun:test"
import {
  LLMClient,
  LLMEvent,
  Model,
  type LLMClientShape,
  type LLMRequest,
} from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Database } from "@opencode-ai/core/database/database"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { Tool } from "@opencode-ai/core/tool/tool"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { Location } from "@opencode-ai/core/location"
import { ReflectionState } from "@opencode-ai/core/session/runner/reflection-state"
import { Effect, Layer, Schema, Stream } from "effect"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const requests: LLMRequest[] = []
let responses: LLMEvent[][] = []

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      const events = responses.shift() ?? []
      return Stream.fromIterable(events)
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const testTools = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      run_test: Tool.make({
        description: "Run test suite",
        input: Schema.Struct({ cmd: Schema.String }),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: () => Effect.succeed({ text: "FAIL: test failed with assertion error" }),
      }),
    }),
  ),
)
const toolNode = makeLocationNode({ name: "test/reasoning-e2e-tools", layer: testTools, deps: [ToolRegistry.node] })

const systemContextKey = SystemContext.Key.make("test/reasoning-context")
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({
        key: systemContextKey,
        load: Effect.succeed(
          SystemContext.combine([
            SystemContext.make({
              key: systemContextKey,
              codec: Schema.toCodecJson(Schema.String),
              load: Effect.succeed("Test system context"),
              baseline: String,
              update: (_prev, current) => current,
              removed: () => "removed",
            }),
          ]),
        ),
      }),
    ),
  ),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))

import { ConfigCompaction } from "@opencode-ai/core/config/compaction"

const skillGuidance = Layer.mock(SkillGuidance.Service, {
  load: () => Effect.succeed(SystemContext.empty),
})
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, {
  load: () => Effect.succeed(SystemContext.empty),
})
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
            }),
          }),
        }),
      ]),
  }),
)

const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
      reflect: () => Effect.die("unused"),
      whyLoop: () => Effect.die("unused"),
      thenLoop: () => Effect.die("unused"),
      escalate: () => Effect.succeed({ escalated: true, message: "mock" }),
    })
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      EventV2.node,
      Database.node,
      SessionProjector.node,
      SessionStore.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      toolNode,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [SessionRunnerModel.node, models],
      [SystemContextRegistry.node, systemContext],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_v2_reasoning_e2e")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  requests.length = 0
  responses = []
  ReflectionState.clearDirection(sessionID)
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: sessionID,
      directory: "/project",
      title: "test reasoning",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

describe("SessionRunnerLLM V2 Reasoning Loops E2E (Option B)", () => {
  it.effect("exercises whyLoop on tool settlement failure and thenLoop on turn completion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service

      responses = [
        // 1. Assistant Turn 1
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-turn1" }),
          LLMEvent.textDelta({ id: "text-turn1", text: "I will execute the test suite to verify implementation." }),
          LLMEvent.textEnd({ id: "text-turn1" }),
          LLMEvent.toolCall({ id: "call-test-1", name: "run_test", input: { cmd: "bun test" } }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        // 2. whyLoop reflection stream
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-why" }),
          LLMEvent.textDelta({
            id: "text-why",
            text: [
              "VERDICT: GOAL_SHIFT: Fix failing assertion in queue test",
              "PREMORTEM: RISK: Broken queue will cause deadlock in workers",
              "INVARIANTS: VIOLATED: Test assertions must pass",
              "HYPOTHESES: [0.8] Assertion value mismatch | [0.2] Race condition in timer",
              "STEER: Update the assertion threshold and adjust lease duration",
            ].join("\n"),
          }),
          LLMEvent.textEnd({ id: "text-why" }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
        // 3. Assistant Turn 2 (resumed by continuation from steer)
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-turn2" }),
          LLMEvent.textDelta({ id: "text-turn2", text: "I have adjusted the lease duration. Perhaps this resolves the timing discrepancy." }),
          LLMEvent.textEnd({ id: "text-turn2" }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
        // 4. thenLoop forward-projection stream
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-then" }),
          LLMEvent.textDelta({
            id: "text-then",
            text: [
              "VERDICT: CONVERGED",
              "PREMORTEM: SAFE",
              "INVARIANTS: SATISFIED",
              "HYPOTHESES: NONE",
              "STEER: NONE",
              "No issues identified. Solution is fully verified and sound.",
            ].join("\n"),
          }),
          LLMEvent.textEnd({ id: "text-then" }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
      ]

      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Please implement and test the job queue" }),
        resume: false,
      })
      yield* session.resume(sessionID)

      expect(requests.length).toBeGreaterThanOrEqual(4)

      const state = ReflectionState.get(sessionID)
      expect(state.hypotheses.length).toBeGreaterThanOrEqual(1)
      expect(state.hypotheses.some((h) => h.description.includes("Assertion value mismatch"))).toBe(true)
      expect(state.directionConfirmed).toBe(true)
      expect(state.lastThenConverged).toBe(true)

      const events = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)

      const reasoningEvents = events.filter((e) => e.type.startsWith("session.next.reasoning.log.recorded"))
      expect(reasoningEvents.length).toBeGreaterThanOrEqual(1)

      const messages = yield* session.messages({ sessionID, order: "asc" })
      expect(messages.length).toBeGreaterThanOrEqual(2)
      expect(messages[0].type).toBe("user")
      expect(messages[1].type).toBe("assistant")
    }),
  )
})
