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
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { SessionV2 } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
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
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { Tool } from "@opencode-ai/core/tool/tool"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { KnowledgeGuidance } from "@opencode-ai/core/knowledge/guidance"
import { KnowledgeRetrieval } from "@opencode-ai/core/knowledge/retrieval"
import { Effect, Layer, Schema, Stream } from "effect"
import { testEffect } from "../lib/effect"

// Phase 4A.1 Definition of Done:
// Brand New Session → First User Prompt → KnowledgeGuidance → Retrieved Knowledge → LLM
// with no pre-existing SessionHistory. KnowledgeGuidance is REAL here; only the
// retrieval engine is stubbed (deterministic docs + captured queries).

const FLAG = "OPENCODE_EXPERIMENTAL_KNOWLEDGE"
const withFlag = <A, E, R>(value: string | undefined, effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.sync(() => process.env[FLAG]), (previous) =>
    Effect.suspend(() => {
      if (value === undefined) delete process.env[FLAG]
      else process.env[FLAG] = value
      return effect
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (previous === undefined) delete process.env[FLAG]
          else process.env[FLAG] = previous
        }),
      ),
    ),
  )

const requests: LLMRequest[] = []
let response: LLMEvent[] = []
const capturedQueries: string[] = []
let stubDocs: ReadonlyArray<KnowledgeRetrieval.Doc> = []

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(response)
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
const echo = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      echo: Tool.make({
        description: "Echo text",
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.Struct({ text: Schema.String }),
        execute: ({ text }) => Effect.succeed({ text }),
      }),
    }),
  ),
)
const echoNode = makeLocationNode({ name: "test/knowledge-first-turn-tools", layer: echo, deps: [ToolRegistry.node] })
const systemContextKey = SystemContext.Key.make("test/context")
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({
        key: systemContextKey,
        load: Effect.sync(() =>
          SystemContext.make({
            key: systemContextKey,
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed("Initial context"),
            baseline: String,
            update: (_previous, current) => current,
            removed: () => "System context source removed: test/context",
          }),
        ),
      }),
    ),
  ),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const retrievalMock = Layer.mock(KnowledgeRetrieval.Service, {
  search: (query: string, topK: number) =>
    Effect.succeed(capturedQueries.push(query) > 0 ? stubDocs.slice(0, topK) : stubDocs.slice(0, topK)),
})
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({ buffer: 3000, keep: new ConfigCompaction.Keep({ tokens: 1000 }) }),
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
  [KnowledgeRetrieval.node, retrievalMock],
  [PermissionV2.node, permission],
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
      SessionProjector.node,
      SessionStore.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      echoNode,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      KnowledgeRetrieval.node,
      KnowledgeGuidance.node,
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
      [KnowledgeRetrieval.node, retrievalMock],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_knowledge_first_turn")
const flagOffSessionID = SessionV2.ID.make("ses_knowledge_first_turn_flagoff")

const insertSession = (id: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: "first-turn proof",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const setup = Effect.gen(function* () {
  response = []
  capturedQueries.length = 0
  stubDocs = []
  yield* insertSession(sessionID)
  yield* insertSession(flagOffSessionID)
})

describe("Phase 4A.1 first-turn retrieval (DoD)", () => {
  it.effect("delivers retrieved knowledge to the LLM on a brand new session first turn", () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        yield* setup
        stubDocs = [
          {
            title: "first-turn-doc",
            section: "runner",
            content: "admission before promotion",
            similarity: 0.9,
          },
        ]
        const session = yield* SessionV2.Service
        const promptText = "explain session runner architecture and prompt admission flow"
        yield* session.prompt({ sessionID, prompt: Prompt.make({ text: promptText }), resume: false })

        requests.length = 0
        response = []
        yield* session.resume(sessionID)

        expect(capturedQueries).toEqual([promptText])
        expect(requests.length).toBeGreaterThan(0)
        expect(requests.at(-1)?.system.map((part) => part.text).join("\n\n")).toContain("<retrieved_knowledge>")
        expect(requests.at(-1)?.system.map((part) => part.text).join("\n\n")).toContain("first-turn-doc")
      }),
    ),
  )

  it.effect("sends no knowledge on the first turn when the flag is off", () =>
    withFlag(
      undefined,
      Effect.gen(function* () {
        yield* setup
        stubDocs = [
          { title: "unused", section: "runner", content: "unused", similarity: 0.9 },
        ]
        const session = yield* SessionV2.Service
        yield* session.prompt({
          sessionID: flagOffSessionID,
          prompt: Prompt.make({ text: "explain session runner architecture and prompt admission flow" }),
          resume: false,
        })

        requests.length = 0
        response = []
        yield* session.resume(flagOffSessionID)

        expect(capturedQueries).toEqual([])
        expect(requests.at(-1)?.system.map((part) => part.text)).toEqual(["Initial context"])
      }),
    ),
  )
})
