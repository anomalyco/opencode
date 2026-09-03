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
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionInfinite } from "@opencode-ai/core/session/infinite"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { ConfigInfinite } from "@opencode-ai/core/config/infinite"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { Location } from "@opencode-ai/core/location"
import { Effect, Layer, Schema, Stream } from "effect"
import { testEffect } from "./lib/effect"

const requests: LLMRequest[] = []
let responses: LLMEvent[][] | undefined
let response: LLMEvent[] = []
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses === undefined ? response : (responses.shift() ?? []))
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({
        key: SystemContext.Key.make("test/context"),
        load: Effect.succeed(SystemContext.empty),
      }),
    ),
  ),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
let infiniteOverride: ConfigInfinite.Info | undefined
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
            ...(infiniteOverride ? { infinite: infiniteOverride } : {}),
          }),
        }),
      ]),
  }),
)
const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [Config.node, config],
])
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
    })
  }),
).pipe(Layer.provide(runnerLayer))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      QuestionV2.node,
      PermissionSaved.node,
      SessionProjector.node,
      SessionStore.node,
      SessionTodo.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      PermissionV2.node,
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
const sessionID = SessionV2.ID.make("ses_infinite_test")

const insertSession = (id: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: "test",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  response = []
  responses = undefined
  requests.length = 0
  infiniteOverride = undefined
  SessionInfinite.clear()
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* insertSession(sessionID)
})

const textTurn = (id: string, text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

describe("SessionInfinite", () => {
  it.effect("appends sentinel instruction when the first prompt enables infinite", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const admitted = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Build the feature" }),
        resume: false,
        infinite: true,
      })
      expect(admitted.prompt.text).toContain("[TASK_COMPLETE]")
      expect(admitted.prompt.text).toContain("Build the feature")
      expect(SessionInfinite.isEnabled(sessionID)).toBe(true)
    }),
  )

  it.effect("stops when the assistant emits the sentinel", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const todos = yield* SessionTodo.Service
      yield* todos.update({
        sessionID,
        todos: [{ content: "work", status: "pending", priority: "high" }],
      })
      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Do work" }),
        resume: false,
        infinite: true,
      })
      requests.length = 0
      response = textTurn("a1", "All done [TASK_COMPLETE]")
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(1)
    }),
  )

  it.effect("stops when all todos are done even without the sentinel", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const todos = yield* SessionTodo.Service
      yield* todos.update({
        sessionID,
        todos: [{ content: "work", status: "completed", priority: "high" }],
      })
      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Do work" }),
        resume: false,
        infinite: true,
      })
      requests.length = 0
      response = textTurn("a1", "Partial progress without sentinel")
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(1)
    }),
  )

  it.effect("continues when the sentinel is missing and todos remain open", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const todos = yield* SessionTodo.Service
      yield* todos.update({
        sessionID,
        todos: [{ content: "work", status: "in_progress", priority: "high" }],
      })
      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Do work" }),
        resume: false,
        infinite: true,
      })
      requests.length = 0
      responses = [textTurn("a1", "Still working"), textTurn("a2", "Finished [TASK_COMPLETE]")]
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(2)
      const context = yield* session.context(sessionID)
      const users = context.filter((message) => message.type === "user")
      expect(users.length).toBeGreaterThanOrEqual(2)
      expect(SessionInfinite.getProgress(sessionID)?.iterations).toBe(1)
    }),
  )

  it.effect("respects maxIterations", () =>
    Effect.gen(function* () {
      yield* setup
      infiniteOverride = new ConfigInfinite.Info({ maxIterations: 1 })
      const session = yield* SessionV2.Service
      const todos = yield* SessionTodo.Service
      yield* todos.update({
        sessionID,
        todos: [{ content: "work", status: "pending", priority: "high" }],
      })
      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Do work" }),
        resume: false,
        infinite: true,
      })
      requests.length = 0
      responses = [
        textTurn("a1", "Working 1"),
        textTurn("a2", "Working 2"),
        textTurn("a3", "Working 3"),
      ]
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(2)
      expect(SessionInfinite.getProgress(sessionID)?.iterations).toBe(1)
    }),
  )

  it.effect("does not continue while a permission request is pending", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const todos = yield* SessionTodo.Service
      const permissions = yield* PermissionV2.Service
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
          agent.permissions.push({ action: "read", resource: "secret.env", effect: "ask" })
        }),
      )
      yield* todos.update({
        sessionID,
        todos: [{ content: "work", status: "pending", priority: "high" }],
      })
      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Do work" }),
        resume: false,
        infinite: true,
      })
      const askResult = yield* permissions.ask({
        sessionID,
        action: "read",
        resources: ["secret.env"],
      })
      expect(askResult.effect).toBe("ask")
      requests.length = 0
      response = textTurn("a1", "Working without sentinel")
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(1)
    }),
  )

  it.effect("does not continue after a provider error", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const todos = yield* SessionTodo.Service
      yield* todos.update({
        sessionID,
        todos: [{ content: "work", status: "pending", priority: "high" }],
      })
      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Do work" }),
        resume: false,
        infinite: true,
      })
      requests.length = 0
      responses = [[LLMEvent.providerError({ message: "boom" })]]
      const exit = yield* session.resume(sessionID).pipe(Effect.exit)
      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        { type: "assistant", finish: "error" },
      ])
      void exit
    }),
  )
})
