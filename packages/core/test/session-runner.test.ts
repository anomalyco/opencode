import { describe, expect, test } from "bun:test"
import {
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  Model,
  SystemPart,
  ToolFailure,
  TransportReason,
  InvalidProviderOutputReason,
  InvalidRequestReason,
  RateLimitReason,
  type LLMClientShape,
  type LLMRequest,
} from "@opencode-ai/ai"
import * as OpenAIChat from "@opencode-ai/ai/protocols/openai-chat"
import { Catalog } from "@opencode-ai/core/catalog"
import { Database } from "@opencode-ai/core/database/database"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Form } from "@opencode-ai/core/form"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionPending } from "@opencode-ai/core/session/pending"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Money } from "@opencode-ai/schema/money"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { SystemPromptPlugin } from "@opencode-ai/core/plugin/system-prompt"
import { QuestionTool } from "@opencode-ai/core/tool/question"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { Tool } from "@opencode-ai/core/tool/tool"
import {
  InstructionStateTable,
  SessionPendingTable,
  SessionMessageTable,
  SessionTable,
} from "@opencode-ai/core/session/sql"
import { InstructionEntry } from "@opencode-ai/core/session/instruction-entry"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Instructions } from "@opencode-ai/core/instructions"
import { InstructionBuiltIns } from "@opencode-ai/core/instructions/builtins"
import { InstructionDiscovery } from "@opencode-ai/core/instruction-discovery"
import { SkillInstructions } from "@opencode-ai/core/skill/instructions"
import { ReferenceInstructions } from "@opencode-ai/core/reference/instructions"
import { McpInstructions } from "@opencode-ai/core/mcp/instructions"
import { ModelV2 } from "@opencode-ai/core/model"
import { Location } from "@opencode-ai/core/location"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { asc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"
import { agentHost, catalogHost, host } from "./plugin/host"
import PROMPT_DEFAULT from "../src/session/runner/prompt/base.txt"

const requests: LLMRequest[] = []
let response: LLMEvent[] = []
let responses: LLMEvent[][] | undefined
let responseStream: Stream.Stream<LLMEvent, LLMError> | undefined
let responseStreams: Stream.Stream<LLMEvent, LLMError>[] | undefined
let streamGate: Deferred.Deferred<void> | undefined
let streamStarted: Deferred.Deferred<void> | undefined
let streamFailure: LLMError | undefined
let toolExecutionGate: Deferred.Deferred<void> | undefined
let toolExecutionsStarted: Deferred.Deferred<void> | undefined
let toolExecutionsReady = 5
let activeToolExecutions = 0
let maxActiveToolExecutions = 0
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      if (responseStreams) return responseStreams.shift() ?? Stream.empty
      if (responseStream) {
        const stream = responseStream
        responseStream = undefined
        return stream
      }
      const events = streamFailure
        ? Stream.fail(streamFailure)
        : Stream.fromIterable(responses === undefined ? response : (responses.shift() ?? []))
      if (!streamGate) return events
      return Stream.unwrap(
        (streamStarted ? Deferred.succeed(streamStarted, undefined) : Effect.void).pipe(
          Effect.andThen(Deferred.await(streamGate)),
          Effect.as(events),
        ),
      )
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const reply = {
  stop: () => [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.stepFinish({ index: 0, reason: "stop" }),
    LLMEvent.finish({ reason: "stop" }),
  ],
  text: (text: string, id: string) => fragmentFixture("text", id, [text]).completeEvents,
  textWithUsage: (text: string, id: string, inputTokens: number) =>
    fragmentFixture("text", id, [text]).completeEvents.map((event) =>
      LLMEvent.is.stepFinish(event)
        ? LLMEvent.stepFinish({
            index: event.index,
            reason: event.reason,
            usage: { inputTokens, nonCachedInputTokens: inputTokens },
          })
        : event,
    ),
  tool: (id: string, name: string, input: unknown) => [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.toolCall({ id, name, input }),
    LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
    LLMEvent.finish({ reason: "tool-calls" }),
  ],
}
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const defaultSystem = PROMPT_DEFAULT
const replacementModel = Model.make({ id: "replacement", provider: "fake", route: OpenAIChat.route })
const compactModel = Model.make({
  id: "compact",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 4_000, output: 50 } }),
})
const fullOutputModel = Model.make({
  id: "full-output",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 262_144, output: 262_144 } }),
})
const undersizedContextModel = Model.make({
  id: "undersized-context",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 1, output: 1_000 } }),
})
const recoveryModel = Model.make({
  id: "recovery",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 20_000, output: 1_000 } }),
})

test("calculates step cost using the matching context tier", () => {
  expect(
    SessionRunnerLLM.calculateCost(
      [
        {
          input: Money.USDPerMillionTokens.make(1),
          output: Money.USDPerMillionTokens.make(2),
          cache: {
            read: Money.USDPerMillionTokens.make(0.1),
            write: Money.USDPerMillionTokens.make(0.5),
          },
        },
        {
          tier: { type: "context", size: 100 },
          input: Money.USDPerMillionTokens.make(3),
          output: Money.USDPerMillionTokens.make(4),
          cache: {
            read: Money.USDPerMillionTokens.make(0.2),
            write: Money.USDPerMillionTokens.make(0.6),
          },
        },
      ],
      { input: 80, output: 10, reasoning: 2, cache: { read: 20, write: 1 } },
    ),
  ).toBeCloseTo(0.0002926)
})

test("does not apply an ineligible tier without base pricing", () => {
  expect(
    SessionRunnerLLM.calculateCost(
      [
        {
          tier: { type: "context", size: 100 },
          input: Money.USDPerMillionTokens.make(3),
          output: Money.USDPerMillionTokens.make(4),
          cache: {
            read: Money.USDPerMillionTokens.make(0.2),
            write: Money.USDPerMillionTokens.make(0.6),
          },
        },
      ],
      { input: 80, output: 10, reasoning: 2, cache: { read: 20, write: 0 } },
    ),
  ).toBe(Money.USD.zero)
})

const authorizations: Tool.Context[] = []
const executions: string[] = []
const permissionFail = Tool.make({
  description: "Reject a permission",
  input: Schema.Struct({}),
  output: Schema.Struct({}),
  execute: () =>
    new ToolFailure({
      message: "Permission denied: edit",
      error: new PermissionV2.BlockedError({
        rules: [],
        permission: "edit",
        resources: ["src/index.ts"],
      }),
    }),
})
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
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: ({ text }, context) =>
          Effect.gen(function* () {
            authorizations.push(context)
            executions.push(text)
            activeToolExecutions++
            maxActiveToolExecutions = Math.max(maxActiveToolExecutions, activeToolExecutions)
            if (activeToolExecutions === toolExecutionsReady && toolExecutionsStarted) {
              yield* Deferred.succeed(toolExecutionsStarted, undefined)
            }
            if (toolExecutionGate) yield* Deferred.await(toolExecutionGate)
            return { text }
          }).pipe(Effect.ensuring(Effect.sync(() => activeToolExecutions--))),
      }),
      defect: Tool.make({
        description: "Fail unexpectedly",
        input: Schema.Struct({}),
        output: Schema.Struct({}),
        execute: () =>
          (toolExecutionGate ? Deferred.await(toolExecutionGate) : Effect.void).pipe(
            Effect.andThen(Effect.die("unexpected tool defect")),
          ),
      }),
      // BigInt output with no model content forces ToolOutputStore.bound onto its
      // JSON.stringify encode path, which fails with a typed StorageError.
      storefail: Tool.make({
        description: "Produce output that cannot be persisted",
        input: Schema.Struct({}),
        output: Schema.Any,
        execute: () => Effect.succeed({ big: 1n }),
      }),
    }, { codemode: false }),
  ),
)
const echoNode = makeLocationNode({ name: "test/session-runner-tools", layer: echo, deps: [ToolRegistry.node] })
let modelResolveHook = Effect.void
let currentModel = model
const models = SessionRunnerModel.layerWith((session) =>
  modelResolveHook.pipe(
    Effect.as(
      SessionRunnerModel.resolved(
        session.model?.id === "replacement" ? replacementModel : currentModel,
        session.model?.variant,
      ),
    ),
  ),
)
const systemContextKey = Instructions.Key.make("test/context")
let systemBaseline = "Initial context"
let systemRemoved = false
let systemUnavailable = false
let systemLoadHook = Effect.void
const skillBaselines = new Map<AgentV2.ID, string>()
const systemContext = Layer.mock(InstructionBuiltIns.Service, {
  load: () =>
    Effect.sync(() =>
      Instructions.make({
        key: systemContextKey,
        codec: Schema.toCodecJson(Schema.String),
        read: systemLoadHook.pipe(
          Effect.andThen(
            Effect.sync(() =>
              systemUnavailable ? Instructions.unavailable : systemRemoved ? Instructions.removed : systemBaseline,
            ),
          ),
        ),
        render: {
          initial: String,
          changed: (_previous, current) => current,
          removed: () => "System context source removed: test/context",
        },
      }),
    ),
})
const instructionContext = Layer.mock(InstructionDiscovery.Service, { load: () => Effect.succeed(Instructions.empty) })
const skillInstructions = Layer.mock(SkillInstructions.Service, {
  load: (agent) =>
    Effect.succeed(
      skillBaselines.has(agent.id)
        ? Instructions.make({
            key: Instructions.Key.make("test/skill-guidance"),
            codec: Schema.toCodecJson(Schema.String),
            read: Effect.succeed(skillBaselines.get(agent.id)!),
            render: {
              initial: String,
              changed: (_previous, current) => current,
              removed: () => "Skill guidance removed",
            },
          })
        : Instructions.empty,
    ),
})
const referenceInstructions = Layer.mock(ReferenceInstructions.Service, {
  load: () => Effect.succeed(Instructions.empty),
})
const mcpInstructions = Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
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
let pluginFlushHook = Effect.void
const pluginSupervisor = Layer.succeed(
  PluginSupervisor.Service,
  PluginSupervisor.Service.of({
    flush: Effect.suspend(() => pluginFlushHook),
  }),
)
const promptCatalog = Layer.mock(Catalog.Service, {
  provider: {
    get: () => Effect.succeed(undefined),
    all: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
  },
  model: {
    get: () => Effect.succeed(undefined),
    all: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
    default: () => Effect.succeed(undefined),
    small: () => Effect.succeed(undefined),
  },
})
const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [InstructionBuiltIns.node, systemContext],
  [InstructionDiscovery.node, instructionContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [SkillInstructions.node, skillInstructions],
  [ReferenceInstructions.node, referenceInstructions],
  [PermissionV2.node, permission],
  [Config.node, config],
  [McpInstructions.node, mcpInstructions],
  [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  [PluginSupervisor.node, pluginSupervisor],
])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.drain({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
      awaitIdle: coordinator.awaitIdle,
    })
  }),
).pipe(Layer.provide(runnerLayer))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      Form.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      Catalog.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      PluginHooks.node,
      echoNode,
      SessionRunnerModel.node,
      InstructionBuiltIns.node,
      InstructionDiscovery.node,
      InstructionEntry.node,
      SkillInstructions.node,
      ReferenceInstructions.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [Catalog.node, promptCatalog],
      [SessionRunnerModel.node, models],
      [InstructionBuiltIns.node, systemContext],
      [InstructionDiscovery.node, instructionContext],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
      [SkillInstructions.node, skillInstructions],
      [ReferenceInstructions.node, referenceInstructions],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      [PluginSupervisor.node, pluginSupervisor],
    ],
  ),
)
const sessionID = SessionV2.ID.make("ses_runner_test")
const otherSessionID = SessionV2.ID.make("ses_runner_other")
const admit = (session: SessionV2.Interface, text: string) => session.prompt({ sessionID, text, resume: false })

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
  const agents = yield* AgentV2.Service
  const catalog = yield* Catalog.Service
  const hooks = yield* PluginHooks.Service
  const pluginHost = host({
    agent: agentHost(agents),
    catalog: catalogHost(catalog),
    session: { hook: (name, callback) => hooks.register("session", name, callback) },
  })
  yield* Effect.forEach(SystemPromptPlugin.Plugins, (plugin) => plugin.effect(pluginHost), {
    discard: true,
  })
  requests.length = 0
  authorizations.length = 0
  executions.length = 0
  response = []
  systemBaseline = "Initial context"
  systemRemoved = false
  systemUnavailable = false
  systemLoadHook = Effect.void
  modelResolveHook = Effect.void
  pluginFlushHook = Effect.void
  currentModel = model
  skillBaselines.clear()
  responses = undefined
  streamFailure = undefined
  responseStream = undefined
  responseStreams = undefined
  streamGate = undefined
  streamStarted = undefined
  toolExecutionGate = undefined
  toolExecutionsStarted = undefined
  toolExecutionsReady = 5
  activeToolExecutions = 0
  maxActiveToolExecutions = 0
  yield* agents.transform((draft) =>
    draft.update(AgentV2.ID.make("build"), (agent) => {
      agent.mode = "primary"
    }),
  )
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* insertSession(sessionID)
  return yield* SessionV2.Service
})

const providerUnavailable = () =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new TransportReason({ message: "Provider unavailable" }),
  })

const invalidRequest = () =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new InvalidRequestReason({ message: "Invalid request" }),
  })

const rateLimited = (retryAfterMs?: number) =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new RateLimitReason({ message: "Rate limited", retryAfterMs }),
  })

const setupOverflowRecovery = Effect.gen(function* () {
  const session = yield* setup
  response = reply.text("Earlier answer", "text-earlier")
  yield* admit(session, "Earlier question ".repeat(700))
  yield* session.resume(sessionID)
  currentModel = recoveryModel
  requests.length = 0
  return session
})

const messageTexts = (request: LLMRequest, role: "user" | "system") =>
  request.messages.flatMap((message) =>
    message.role === role ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : [])) : [],
  )
const userTexts = (request: LLMRequest) => messageTexts(request, "user")
const systemTexts = (request: LLMRequest) => messageTexts(request, "system")

const recordedEventTypes = (id: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select({ type: EventTable.type })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, id))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.map((row) => row.type)),
      )
  })

const recordedStepSettlementEvents = (id: SessionV2.ID, assistantMessageID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const settlementTypes = new Set([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.success.1",
      "session.tool.failed.1",
      "session.step.ended.1",
      "session.step.failed.1",
    ])
    return (yield* db
      .select({ type: EventTable.type, data: EventTable.data })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, id))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)).filter(
      (event) => settlementTypes.has(event.type) && event.data.assistantMessageID === assistantMessageID,
    )
  })

const hostedCall = (id: string, query: string) =>
  LLMEvent.toolCall({ id, name: "web_search", input: { query }, providerExecuted: true })

const requireAssistant = (messages: readonly SessionMessage.Info[]) => {
  const assistant = messages.find((message) => message.type === "assistant")
  if (!assistant) throw new Error("Assistant message missing")
  return assistant
}

const replaySessionProjection = (id: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const recorded = yield* db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, id))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)

    yield* events.remove(id)
    yield* db.delete(InstructionStateTable).where(eq(InstructionStateTable.session_id, id)).run().pipe(Effect.orDie)
    yield* db.delete(SessionPendingTable).where(eq(SessionPendingTable.session_id, id)).run().pipe(Effect.orDie)
    yield* db.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, id)).run().pipe(Effect.orDie)
    yield* events.replayAll(
      recorded.map((event) => ({
        id: event.id,
        created: DateTime.makeUnsafe(event.created),
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      })),
    )
  })

type FragmentKind = "text" | "reasoning" | "tool input"

type FragmentFixture = {
  readonly delta: EventV2.Definition
  readonly completeEvents: LLMEvent[]
  readonly partialEvents: LLMEvent[]
  readonly expectedAssistant: unknown
  readonly expectedContent: unknown
}

const fragmentKinds: readonly FragmentKind[] = ["text", "reasoning", "tool input"]

const fragmentID = (kind: FragmentKind, suffix: string) => `${kind === "tool input" ? "call" : kind}-${suffix}`

const fragmentFixture = (kind: FragmentKind, id: string, chunks: readonly string[]): FragmentFixture => {
  const text = chunks.join("")
  switch (kind) {
    case "text": {
      const partialEvents = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id }),
        ...chunks.map((text) => LLMEvent.textDelta({ id, text })),
      ]
      const expectedContent = { type: "text", text }
      return {
        delta: SessionEvent.Text.Delta,
        partialEvents,
        completeEvents: [
          ...partialEvents,
          LLMEvent.textEnd({ id }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
        expectedAssistant: { type: "assistant", finish: "stop", content: [expectedContent] },
        expectedContent,
      }
    }
    case "reasoning": {
      const partialEvents = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id }),
        ...chunks.map((text) => LLMEvent.reasoningDelta({ id, text })),
      ]
      const expectedContent = { type: "reasoning", text }
      return {
        delta: SessionEvent.Reasoning.Delta,
        partialEvents,
        completeEvents: [
          ...partialEvents,
          LLMEvent.reasoningEnd({ id }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
        expectedAssistant: { type: "assistant", finish: "stop", content: [expectedContent] },
        expectedContent,
      }
    }
    case "tool input": {
      const partialEvents = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id, name: "echo" }),
        ...chunks.map((text) => LLMEvent.toolInputDelta({ id, name: "echo", text })),
      ]
      const expectedContent = { type: "tool", id, state: { status: "streaming", input: text } }
      return {
        delta: SessionEvent.Tool.Input.Delta,
        partialEvents,
        completeEvents: [...partialEvents, LLMEvent.toolInputEnd({ id, name: "echo" })],
        expectedAssistant: { type: "assistant", content: [expectedContent] },
        expectedContent,
      }
    }
  }
}

const verifyEphemeralDeltas = (kind: FragmentKind) =>
  Effect.gen(function* () {
    const session = yield* setup
    const prompt = `Stream ${kind}`
    const chunks = Array.from({ length: 32 }, (_, index) => `${index},`)
    const fixture = fragmentFixture(kind, fragmentID(kind, "many"), chunks)
    const expectedContext = [{ type: "user", text: prompt }, fixture.expectedAssistant]
    yield* admit(session, prompt)
    const events = yield* EventV2.Service
    const live = yield* events.subscribe(fixture.delta).pipe(Stream.take(32), Stream.runCollect, Effect.forkScoped)
    yield* Effect.yieldNow
    response = fixture.completeEvents

    yield* session.resume(sessionID)

    const { db } = yield* Database.Service
    const deltas = yield* db
      .select({ type: EventTable.type })
      .from(EventTable)
      .where(eq(EventTable.type, EventV2.versionedType(fixture.delta.type, 1)))
      .all()
      .pipe(Effect.orDie)
    expect(Array.from(yield* Fiber.join(live))).toHaveLength(32)
    expect(deltas).toHaveLength(0)
    expect(yield* session.context(sessionID)).toMatchObject(expectedContext)

    yield* replaySessionProjection(sessionID)

    expect(yield* session.context(sessionID)).toMatchObject(expectedContext)
  })

const verifyPartialFlushOnFailure = (kind: FragmentKind) =>
  Effect.gen(function* () {
    const session = yield* setup
    const prompt = `Fail after ${kind}`
    const fixture = fragmentFixture(kind, fragmentID(kind, "partial"), ["Partial"])
    const failure = providerUnavailable()
    yield* admit(session, prompt)
    responseStream = Stream.concat(Stream.fromIterable(fixture.partialEvents), Stream.fail(failure))

    expect(yield* session.resume(sessionID).pipe(Effect.flip)).toBe(failure)
    expect(yield* session.context(sessionID)).toMatchObject([
      { type: "user", text: prompt },
      {
        type: "assistant",
        finish: "error",
        error: { type: "provider.transport", message: "Provider unavailable" },
        content: [
          kind === "tool input"
            ? {
                type: "tool",
                id: fragmentID(kind, "partial"),
                state: {
                  status: "error",
                  error: { type: "provider.transport", message: "Provider unavailable" },
                },
              }
            : fixture.expectedContent,
        ],
      },
    ])
    expect(requests).toHaveLength(1)
  })

const verifyPartialFlushOnInterruption = (kind: FragmentKind) =>
  Effect.gen(function* () {
    const session = yield* setup
    const prompt = `Interrupt after ${kind}`
    const fixture = fragmentFixture(kind, fragmentID(kind, "interrupted"), ["Partial"])
    const streamed = yield* Deferred.make<void>()
    yield* admit(session, prompt)
    responseStream = Stream.concat(
      Stream.fromIterable(fixture.partialEvents),
      Stream.fromEffect(Deferred.succeed(streamed, undefined)).pipe(Stream.flatMap(() => Stream.never)),
    )

    const runner = yield* SessionRunner.Service
    const fiber = yield* runner.drain({ sessionID, force: true }).pipe(Effect.forkChild)
    yield* Deferred.await(streamed)
    yield* Fiber.interrupt(fiber)
    expect(yield* session.context(sessionID)).toMatchObject([
      { type: "user", text: prompt },
      {
        type: "assistant",
        finish: "error",
        error: { type: "aborted", message: "Step interrupted" },
        content: [
          kind === "tool input"
            ? { type: "tool", id: fragmentID(kind, "interrupted"), state: { status: "error" } }
            : fixture.expectedContent,
        ],
      },
    ])
  })

describe("SessionRunnerLLM", () => {
  it.effect("applies session context hooks without exposing unavailable tools", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("session", "context", (event) =>
        Effect.sync(() => {
          event.system = [SystemPart.make("Hooked system")]
          event.messages = [Message.user("Hooked message")]
          delete event.tools.echo
          event.tools.unregistered = { description: "Unavailable", input: { type: "object" } }
        }),
      )
      yield* admit(session, "Original message")
      responses = [reply.tool("call-removed", "echo", { text: "blocked" })]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.system.map((part) => part.text)).toEqual(["Hooked system"])
      expect(requests[0]?.messages).toEqual([Message.user("Hooked message")])
      expect(requests[0]?.tools.map((tool) => tool.name)).not.toContain("echo")
      expect(requests[0]?.tools.map((tool) => tool.name)).not.toContain("unregistered")
      expect(executions).toEqual([])
    }),
  )

  it.effect("advertises and executes a location registered tool", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* ToolRegistry.Service
      const contexts: Tool.Context[] = []
      yield* registry.register({
        location_context: Tool.make({
          description: "Read application context",
          input: Schema.Struct({ query: Schema.String }),
          output: Schema.Struct({ answer: Schema.String }),
          execute: ({ query }, context) =>
            Effect.gen(function* () {
              contexts.push(context)
              yield* context.progress({ structured: { phase: "reading" } })
              return { answer: query.toUpperCase() }
            }),
        }),
      }, { codemode: false })
      yield* admit(session, "Use application context")
      responses = [reply.tool("call-location", "location_context", { query: "hello" }), []]
      const events = yield* EventV2.Service
      const progressFiber = yield* events.subscribe(SessionEvent.Tool.Progress).pipe(
        Stream.filter((event) => event.data.sessionID === sessionID && event.data.callID === "call-location"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* session.resume(sessionID)

      expect(requests[0]?.tools.map((tool) => tool.name)).toContain("location_context")
      expect(contexts).toEqual([
        {
          sessionID,
          agent: AgentV2.ID.make("build"),
          messageID: expect.stringMatching(/^msg_/),
          callID: "call-location",
          progress: expect.any(Function),
        },
      ])
      expect(Array.from(yield* Fiber.join(progressFiber))[0]?.data.structured).toEqual({ phase: "reading" })
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Use application context" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-location",
              state: { status: "completed", structured: { answer: "HELLO" } },
            },
          ],
        },
      ])
    }),
  )

  it.effect("executes the tool advertised before a registry reload", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      const executions: string[] = []
      yield* registry
        .register({
          reloaded: Tool.make({
            description: "Record the advertised tool",
            input: Schema.Struct({}),
            output: Schema.Struct({ value: Schema.String }),
            execute: () => Effect.sync(() => executions.push("advertised")).pipe(Effect.as({ value: "advertised" })),
          }),
        }, { codemode: false })
        .pipe(Scope.provide(scope))
      yield* admit(session, "Use the reloaded tool")
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-reloaded", name: "reloaded", input: {} }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        [],
      ]
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* Scope.close(scope, Exit.void)
      yield* registry.register({
        reloaded: Tool.make({
          description: "Record the replacement tool",
          input: Schema.Struct({}),
          output: Schema.Struct({ value: Schema.String }),
          execute: () => Effect.sync(() => executions.push("replacement")).pipe(Effect.as({ value: "replacement" })),
        }),
      }, { codemode: false })
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(run)

      expect(executions).toEqual(["advertised"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Use the reloaded tool" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-reloaded",
              state: { status: "completed", structured: { value: "advertised" } },
            },
          ],
        },
      ])
    }),
  )

  it.effect("starts a real runner step after default prompt recording", () =>
    Effect.gen(function* () {
      const session = yield* setup

      const message = yield* session.prompt({
        sessionID,
        text: "Run automatically",
      })
      yield* session.wait(sessionID)

      expect(requests).toHaveLength(1)
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: message.id, type: "user", text: "Run automatically" },
      ])
    }),
  )

  it.effect("runs a follow-up when synthetic input arrives during an active continuation", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const secondStarted = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()
      responseStreams = [
        Stream.fromIterable(reply.tool("call-echo", "echo", { text: "background started" })),
        Stream.unwrap(
          Deferred.succeed(secondStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseSecond)),
            Effect.as(Stream.fromIterable(reply.stop())),
          ),
        ),
        Stream.fromIterable(reply.text("Handled completion", "text-completion")),
      ]
      yield* admit(session, "Start background work")
      const running = yield* session.resume(sessionID).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(secondStarted)

      yield* session.synthetic({ sessionID, text: "Background work completed" })
      yield* Deferred.succeed(releaseSecond, undefined)
      yield* Fiber.join(running)

      expect(requests).toHaveLength(3)
      expect(userTexts(requests[2]!)).toContain("Background work completed")
    }),
  )

  it.effect("streams one request with registry definitions from chronological V2 user history", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "First")
      yield* admit(session, "Second")

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.model).toBe(model)
      expect(requests[0]?.tools.map((tool) => tool.name)).toEqual(["echo", "defect", "storefail"])
      expect(requests[0]?.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
        { role: "user", content: [{ type: "text", text: "First" }] },
        { role: "user", content: [{ type: "text", text: "Second" }] },
      ])
      expect(yield* session.messages({ sessionID })).toHaveLength(2)
    }),
  )

  it.effect("marks the initial instruction sync as baseline metadata", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      const instructionEvents: EventV2.Payload[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === "session.instructions.updated") instructionEvents.push(event)
        }),
      )
      yield* admit(session, "First")

      yield* session.resume(sessionID)
      systemBaseline = "Changed context"
      yield* admit(session, "Second")
      yield* session.resume(sessionID)
      yield* unsubscribe

      expect(instructionEvents).toHaveLength(2)
      expect(instructionEvents[0]?.metadata).toEqual({ instructions: { initial: true } })
      expect(instructionEvents[1]?.metadata).toBeUndefined()
    }),
  )

  it.effect("retries the first request after system context becomes available", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      const messageID = SessionMessage.ID.create()
      systemUnavailable = true
      yield* session.prompt({
        id: messageID,
        sessionID,
        text: "First",
        resume: false,
      })

      const exit = yield* session.resume(sessionID).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Instructions.InitializationBlocked)
      expect(requests).toHaveLength(0)
      expect(yield* SessionPending.has(db, sessionID, "steer")).toBe(true)
      expect(
        yield* db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).get(),
      ).toBeUndefined()

      systemUnavailable = false
      yield* session.prompt({ id: messageID, sessionID, text: "First" })
      yield* session.wait(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.messages.map((message) => message.role)).toEqual(["user"])
    }),
  )

  it.effect("interrupts a source Location runner after a Session moves", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      yield* admit(session, "First")
      yield* session.resume(sessionID)

      yield* events.publish(SessionEvent.Moved, {
        sessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/moved") }),
      })
      expect(
        yield* db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).get(),
      ).toBeUndefined()

      yield* admit(session, "Second")
      const exit = yield* session.resume(sessionID).pipe(Effect.exit)

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(requests).toHaveLength(1)
      expect(yield* SessionPending.has(db, sessionID, "steer")).toBe(true)
    }),
  )

  it.effect("forks instruction values at the selected message instead of the parent's latest state", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const first = yield* admit(session, "First")
      yield* session.resume(sessionID)
      systemBaseline = "Changed context"
      const second = yield* admit(session, "Second")
      yield* session.resume(sessionID)
      systemBaseline = "Latest context"
      yield* admit(session, "Third")
      yield* session.resume(sessionID)

      const forked = yield* session.fork({ sessionID, messageID: second.id })
      expect(
        yield* (yield* Database.Service).db
          .select()
          .from(InstructionStateTable)
          .where(eq(InstructionStateTable.session_id, forked.id))
          .get(),
      ).toMatchObject({
        initial_values: { "test/context": Instructions.hash("Initial context") },
        current_values: { "test/context": Instructions.hash("Changed context") },
      })
      yield* session.prompt({ sessionID: forked.id, text: "Forked", resume: false })
      yield* session.resume(forked.id)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual([defaultSystem, "Initial context"])
      expect(systemTexts(requests.at(-1)!)).toContain("Changed context")
      expect(systemTexts(requests.at(-1)!)).toContain("Latest context")

      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, forked.id))
        .orderBy(asc(EventTable.seq))
        .all()
      yield* events.remove(forked.id)
      yield* db.delete(SessionTable).where(eq(SessionTable.id, forked.id)).run()
      yield* events.replayAll(
        recorded.map((event) => ({
          id: event.id,
          created: DateTime.makeUnsafe(event.created),
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )
      expect(
        yield* db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, forked.id)).get(),
      ).toMatchObject({ current_values: { "test/context": Instructions.hash("Latest context") } })
    }),
  )

  it.effect("caps nested fork instruction ancestry at the selected message", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "First")
      yield* session.resume(sessionID)
      systemBaseline = "Changed context"
      const second = yield* admit(session, "Second")
      yield* session.resume(sessionID)

      const child = yield* session.fork({ sessionID, messageID: second.id })
      const inheritedFirst = (yield* session.messages({ sessionID: child.id })).find(
        (message) => message.type === "user" && message.text === "First",
      )
      if (!inheritedFirst) return yield* Effect.die(new Error("Nested fork boundary message not found"))
      const grandchild = yield* session.fork({ sessionID: child.id, messageID: inheritedFirst.id })

      expect(
        yield* (yield* Database.Service).db
          .select()
          .from(InstructionStateTable)
          .where(eq(InstructionStateTable.session_id, grandchild.id))
          .get(),
      ).toMatchObject({
        initial_values: { "test/context": Instructions.hash("Initial context") },
        current_values: { "test/context": Instructions.hash("Initial context") },
      })
    }),
  )

  it.effect("rebuilds a missing instruction cache without admitting another delta", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      yield* admit(session, "First")
      yield* session.resume(sessionID)
      yield* db.delete(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).run()
      yield* admit(session, "Second")
      requests.length = 0

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.system.map((part) => part.text)).toEqual([defaultSystem, "Initial context"])
      expect(requests[0]?.messages.map((message) => message.role)).toEqual(["user", "user"])
      expect(
        yield* db
          .select({ id: EventTable.id })
          .from(EventTable)
          .where(eq(EventTable.type, "session.instructions.updated.2"))
          .all(),
      ).toHaveLength(1)
      expect(yield* db.select().from(InstructionStateTable).get()).toMatchObject({
        initial_values: { "test/context": Instructions.hash("Initial context") },
        current_values: { "test/context": Instructions.hash("Initial context") },
      })
    }),
  )

  it.effect("keeps the initial instructions stable and derives a chronological update from values", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "First")

      yield* session.resume(sessionID)
      systemBaseline = "Changed context"
      yield* admit(session, "Second")
      yield* session.resume(sessionID)

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
      ])
      expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "system", "user"])
      expect(requests[1]?.messages.at(1)?.content).toEqual([{ type: "text", text: "Changed context" }])
      expect(yield* session.messages({ sessionID })).toHaveLength(2)
      const { db } = yield* Database.Service
      const updates = yield* db
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.type, "session.instructions.updated.2"))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      expect(updates).toHaveLength(2)
      expect(updates[0]?.data).toEqual({
        sessionID,
        delta: { "test/context": Instructions.hash("Initial context") },
      })
      expect(updates[1]?.data).toEqual({
        sessionID,
        delta: { "test/context": Instructions.hash("Changed context") },
      })
      yield* replaySessionProjection(sessionID)
      expect(yield* session.messages({ sessionID })).toHaveLength(2)
    }),
  )

  it.effect("uses the selected model family prompt when the agent does not override it", () =>
    Effect.gen(function* () {
      const session = yield* setup
      currentModel = Model.make({ id: "gpt-5", provider: "openai", route: OpenAIChat.route })
      yield* admit(session, "First")

      response = reply.text("Done", "text-provider-prompt")
      yield* session.resume(sessionID)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual([
        expect.stringContaining("You are OpenCode, You and the user share the same workspace"),
        "Initial context",
      ])
    }),
  )

  it.effect("uses the selected model family prompt when the agent system override is empty", () =>
    Effect.gen(function* () {
      const session = yield* setup
      currentModel = Model.make({ id: "gpt-5", provider: "openai", route: OpenAIChat.route })
      const agent = yield* AgentV2.Service
      yield* agent.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.system = ""
          agent.mode = "primary"
        }),
      )
      yield* admit(session, "First")

      response = reply.text("Done", "text-empty-agent-system")
      yield* session.resume(sessionID)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual([
        expect.stringContaining("You are OpenCode, You and the user share the same workspace"),
        "Initial context",
      ])
    }),
  )

  it.effect("includes the effective default agent system before durable context", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agent = yield* AgentV2.Service
      yield* agent.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.system = "Build agent instructions"
          agent.mode = "primary"
        }),
      )
      yield* admit(session, "First")

      response = reply.text("Done", "text-build")
      yield* session.resume(sessionID)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual(["Build agent instructions", "Initial context"])
    }),
  )

  it.effect("uses the configured default agent system for omitted-agent sessions", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agent = yield* AgentV2.Service
      yield* agent.transform((editor) => {
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.system = "Build agent instructions"
          agent.mode = "primary"
        })
        editor.update(AgentV2.ID.make("reviewer"), (agent) => {
          agent.system = "Reviewer instructions"
          agent.mode = "primary"
        })
        editor.default(AgentV2.ID.make("reviewer"))
      })
      yield* admit(session, "First")

      response = reply.text("Done", "text-reviewer")
      yield* session.resume(sessionID)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual(["Reviewer instructions", "Initial context"])
      expect((yield* session.messages({ sessionID }))[0]).toMatchObject({ type: "assistant", agent: "reviewer" })
    }),
  )

  it.effect("uses only the agent prompt and initial instructions as system parts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agent = yield* AgentV2.Service
      yield* agent.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.system = "Build agent instructions"
          agent.mode = "primary"
        }),
      )
      yield* admit(session, "First")

      response = reply.text("Done", "text-no-system")
      yield* session.resume(sessionID)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual(["Build agent instructions", "Initial context"])
    }),
  )

  it.effect("uses an explicitly selected non-build agent system", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      const agent = yield* AgentV2.Service
      yield* agent.transform((editor) =>
        editor.update(AgentV2.ID.make("reviewer"), (agent) => {
          agent.system = "Reviewer instructions"
          agent.mode = "primary"
        }),
      )
      yield* db
        .update(SessionTable)
        .set({ agent: "reviewer" })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* admit(session, "First")

      response = reply.text("Done", "text-selected")
      yield* session.resume(sessionID)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual(["Reviewer instructions", "Initial context"])
      expect((yield* session.messages({ sessionID }))[0]).toMatchObject({ type: "assistant", agent: "reviewer" })
    }),
  )

  it.effect("fails before the model request when the selected agent is unavailable", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: "explore" })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, text: "Inspect files", resume: false })

      requests.length = 0
      response = []
      const failure = yield* session.resume(sessionID).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "Session.AgentNotFoundError",
        sessionID,
        agent: "explore",
      })
      expect(requests).toHaveLength(0)
    }),
  )

  it.effect("waits for initial plugin readiness before constructing the model request", () =>
    Effect.gen(function* () {
      yield* setup
      const release = yield* Deferred.make<void>()
      pluginFlushHook = Deferred.await(release)
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, text: "Wait for plugins", resume: false })

      requests.length = 0
      response = []
      const running = yield* session.resume(sessionID).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.yieldNow

      expect(requests).toHaveLength(0)
      expect(running.pollUnsafe()).toBeUndefined()

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(running)
      expect(requests).toHaveLength(1)
    }),
  )

  it.effect("updates selected-agent skill instructions after an agent switch", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      const agents = yield* AgentV2.Service
      yield* agents.transform((draft) =>
        draft.update(AgentV2.ID.make("reviewer"), (agent) => {
          agent.mode = "primary"
        }),
      )
      skillBaselines.set(AgentV2.ID.make("build"), "Build skills")
      yield* admit(session, "First")

      yield* session.resume(sessionID)
      skillBaselines.set(AgentV2.ID.make("reviewer"), "Reviewer skills")
      yield* events.publish(SessionEvent.AgentSelected, {
        sessionID,
        agent: AgentV2.ID.make("reviewer"),
      })
      yield* admit(session, "Second")
      yield* session.resume(sessionID)

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context\n\nBuild skills"],
        [defaultSystem, "Initial context\n\nBuild skills"],
      ])
      expect(systemTexts(requests[1]!)).toContainEqual(expect.stringContaining("Reviewer skills"))
    }),
  )

  it.effect("keeps the sampled agent when selection changes during observation", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      skillBaselines.set(AgentV2.ID.make("build"), "Build skills")
      skillBaselines.set(AgentV2.ID.make("reviewer"), "Reviewer skills")
      let switched = false
      systemLoadHook = Effect.suspend(() => {
        if (switched) return Effect.void
        switched = true
        return events
          .publish(SessionEvent.AgentSelected, {
            sessionID,
            agent: AgentV2.ID.make("reviewer"),
          })
          .pipe(Effect.asVoid)
      })
      yield* admit(session, "First")

      yield* session.resume(sessionID)

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context\n\nBuild skills"],
      ])
    }),
  )

  it.effect("keeps the sampled model when selection changes during model resolution", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      let switched = false
      modelResolveHook = Effect.suspend(() => {
        if (switched) return Effect.void
        switched = true
        return events
          .publish(SessionEvent.ModelSelected, {
            sessionID,
            model: { id: ModelV2.ID.make("replacement"), providerID: ProviderV2.ID.make("fake") },
          })
          .pipe(Effect.asVoid)
      })
      yield* admit(session, "First")

      yield* session.resume(sessionID)
      expect(requests.map((request) => request.model)).toEqual([model])
      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
      ])
    }),
  )

  it.effect("admits removed context as a chronological System message", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "First")

      yield* session.resume(sessionID)
      systemRemoved = true
      yield* admit(session, "Second")
      yield* session.resume(sessionID)

      expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "system", "user"])
      expect(requests[1]?.messages.at(1)?.content).toEqual([
        { type: "text", text: "System context source removed: test/context" },
      ])
      expect(yield* session.messages({ sessionID })).toHaveLength(2)
    }),
  )

  it.effect("renders API context entries through add, change, and removal", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const contextEntries = yield* InstructionEntry.Service
      yield* contextEntries.put({ sessionID, key: "deploy-target", value: "production" })
      yield* admit(session, "First")

      yield* session.resume(sessionID)

      // String values render verbatim inside the initial tagged block.
      expect(requests[0]?.system.map((part) => part.text)).toEqual([
        defaultSystem,
        ["Initial context", "", '<context key="deploy-target">', "production", "</context>"].join("\n"),
      ])

      // Non-string JSON pretty-prints; the change narrates as a System update.
      yield* contextEntries.put({ sessionID, key: "deploy-target", value: { region: "us-east-1" } })
      yield* admit(session, "Second")
      yield* session.resume(sessionID)

      expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "system", "user"])
      expect(requests[1]?.messages.at(1)?.content).toEqual([
        {
          type: "text",
          text: [
            'The context under "deploy-target" changed and supersedes the previous value:',
            '<context key="deploy-target">',
            "{",
            '  "region": "us-east-1"',
            "}",
            "</context>",
          ].join("\n"),
        },
      ])
      expect(yield* contextEntries.list(sessionID)).toEqual([{ key: "deploy-target", value: { region: "us-east-1" } }])

      // Deleting the row announces removal through the stored removal text.
      yield* contextEntries.remove({ sessionID, key: "deploy-target" })
      yield* admit(session, "Third")
      yield* session.resume(sessionID)

      expect(requests[2]?.messages.map((message) => message.role)).toEqual(["user", "system", "user", "system", "user"])
      expect(requests[2]?.messages.at(-2)?.content).toEqual([
        { type: "text", text: 'The context under "deploy-target" no longer applies. Disregard it.' },
      ])
      expect(yield* contextEntries.list(sessionID)).toEqual([])
    }),
  )

  it.effect("retains JSON null API entries as values", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const entries = yield* InstructionEntry.Service
      yield* entries.put({ sessionID, key: "nullable", value: "present" })
      yield* admit(session, "First")
      yield* session.resume(sessionID)

      yield* entries.put({ sessionID, key: "nullable", value: null })
      yield* admit(session, "Second")
      yield* session.resume(sessionID)

      expect(requests[1]?.messages.at(1)?.content).toEqual([
        {
          type: "text",
          text: [
            'The context under "nullable" changed and supersedes the previous value:',
            '<context key="nullable">',
            "null",
            "</context>",
          ].join("\n"),
        },
      ])
      expect(yield* entries.list(sessionID)).toEqual([{ key: "nullable", value: null }])
    }),
  )

  it.effect("rejects API instruction entries larger than 8KB", () =>
    Effect.gen(function* () {
      yield* setup
      const entries = yield* InstructionEntry.Service

      const exit = yield* entries
        .put({ sessionID, key: "oversized", value: "x".repeat(InstructionEntry.MaxValueBytes) })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(InstructionEntry.ValueTooLargeError)
      expect(yield* entries.list(sessionID)).toEqual([])
    }),
  )

  it.effect("keeps initial instructions and chronological updates after a model switch", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      yield* admit(session, "First")

      yield* session.resume(sessionID)
      systemBaseline = "Changed context"
      yield* admit(session, "Second")
      yield* session.resume(sessionID)
      yield* events.publish(SessionEvent.ModelSelected, {
        sessionID,
        model: { id: ModelV2.ID.make("replacement"), providerID: ProviderV2.ID.make("fake") },
      })
      systemBaseline = "Replacement context"
      yield* admit(session, "Third")
      yield* session.resume(sessionID)

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
      ])
      expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "system", "user"])
      expect(requests[2]?.messages.filter((message) => message.role === "system")).toHaveLength(2)
      expect((yield* session.context(sessionID)).map((message) => message.type)).toEqual([
        "user",
        "user",
        "model-switched",
        "user",
      ])
      yield* replaySessionProjection(sessionID)
      expect(yield* session.messages({ sessionID })).toHaveLength(4)
      yield* admit(session, "Fourth")
      yield* session.resume(sessionID)
    }),
  )

  it.effect("preserves instruction values while a source is temporarily unavailable", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      yield* admit(session, "First")

      yield* session.resume(sessionID)
      yield* events.publish(SessionEvent.ModelSelected, {
        sessionID,
        model: { id: ModelV2.ID.make("replacement"), providerID: ProviderV2.ID.make("fake") },
      })
      systemUnavailable = true
      yield* admit(session, "Second")
      yield* session.resume(sessionID)
      systemUnavailable = false
      systemBaseline = "Replacement context"
      yield* admit(session, "Third")
      yield* session.resume(sessionID)

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
      ])
    }),
  )

  it.effect("moves the epoch at compaction and narrates later changes", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      yield* admit(session, "First")

      yield* session.resume(sessionID)
      yield* events.publish(SessionEvent.Compaction.Started, {
        sessionID,
        reason: "manual",
        recent: "",
      })
      yield* events.publish(SessionEvent.Compaction.Ended, {
        sessionID,
        reason: "manual",
        text: "summary",
        recent: "",
      })
      systemBaseline = "Replacement context"
      yield* admit(session, "Second")
      yield* session.resume(sessionID)

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
      ])
      expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "system", "user"])
      expect(requests[1]?.messages.at(1)?.content).toEqual([{ type: "text", text: "Replacement context" }])
      yield* replaySessionProjection(sessionID)
      yield* admit(session, "Third")
      yield* session.resume(sessionID)
    }),
  )

  it.effect("runs one durable compaction barrier after tool settlement and before later inputs", () =>
    Effect.gen(function* () {
      const session = yield* setup
      currentModel = recoveryModel
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()
      responses = [
        reply.tool("call-active", "echo", { text: "active" }),
        [LLMEvent.textDelta({ id: "summary", text: "durable summary" })],
        reply.text("Steer complete", "text-steer"),
        reply.text("Queue complete", "text-queue"),
      ]
      yield* admit(session, "Active work")
      const active = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)

      const first = yield* session.compact({ sessionID })
      const second = yield* session.compact({ sessionID })
      expect(second.id).toBe(first.id)
      expect(yield* SessionPending.compaction((yield* Database.Service).db, sessionID)).toMatchObject({
        id: first.id,
      })
      expect((yield* session.messages({ sessionID })).find((message) => message.id === first.id)).toBeUndefined()

      yield* admit(session, "Steer after compaction")
      yield* session.synthetic({ sessionID, text: "Completion after compaction", resume: false })
      yield* session.prompt({
        sessionID,
        text: "Queue after compaction",
        delivery: "queue",
        resume: false,
      })
      expect(yield* SessionPending.has((yield* Database.Service).db, sessionID, "steer")).toBe(false)

      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(active)

      expect(requests).toHaveLength(4)
      expect(userTexts(requests[1])[0]).toContain("Create a new anchored summary")
      expect(userTexts(requests[2])).toContain("Steer after compaction")
      expect(userTexts(requests[2])).toContain("Completion after compaction")
      expect(userTexts(requests[3])).toContain("Queue after compaction")
      expect(yield* SessionPending.compaction((yield* Database.Service).db, sessionID)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === first.id)).toMatchObject({
        type: "compaction",
        status: "completed",
        summary: "durable summary",
      })
    }),
  )

  it.effect("releases queued prompts when durable compaction fails", () =>
    Effect.gen(function* () {
      const session = yield* setup
      currentModel = recoveryModel
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()
      responses = [
        reply.text("Active complete", "text-active-failure"),
        [],
        reply.text("Continued", "text-after-failure"),
      ]
      yield* admit(session, "Active work")
      const active = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)

      const compaction = yield* session.compact({ sessionID })
      yield* session.prompt({
        sessionID,
        text: "Continue after failure",
        delivery: "queue",
        resume: false,
      })
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(active)

      expect(requests).toHaveLength(3)
      expect(userTexts(requests[2])).toContain("Continue after failure")
      expect(yield* SessionPending.compaction((yield* Database.Service).db, sessionID)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
      })
      expect(
        (yield* recordedEventTypes(sessionID)).filter(
          (type) => type === EventV2.versionedType(SessionEvent.Compaction.Failed.type, 1),
        ),
      ).toHaveLength(1)
    }),
  )

  it.effect("explains when manual compaction has no history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const compaction = yield* session.compact({ sessionID })
      modelResolveHook = Effect.die("model resolution should not run")

      yield* session.resume(sessionID)

      expect(yield* SessionPending.compaction((yield* Database.Service).db, sessionID)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
        reason: "manual",
        error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
      })
      expect(
        (yield* recordedEventTypes(sessionID)).filter(
          (type) => type === EventV2.versionedType(SessionEvent.Compaction.Failed.type, 1),
        ),
      ).toHaveLength(1)
    }),
  )

  it.effect("manually compacts when the model has no context limit", () =>
    Effect.gen(function* () {
      const session = yield* setup
      response = reply.text("Earlier answer", "text-manual-unknown-history")
      yield* admit(session, "Earlier question")
      yield* session.resume(sessionID)

      requests.length = 0
      response = reply.text("Manual summary", "text-manual-unknown-summary")
      const compaction = yield* session.compact({ sessionID })
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(userTexts(requests[0])[0]).toContain("Earlier question")
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "completed",
        summary: "Manual summary",
      })
    }),
  )

  it.effect("preserves provider errors from manual compaction", () =>
    Effect.gen(function* () {
      const session = yield* setup
      response = reply.text("Earlier answer", "text-manual-provider-history")
      yield* admit(session, "Earlier question")
      yield* session.resume(sessionID)

      response = [LLMEvent.providerError({ message: "summary unavailable" })]
      const compaction = yield* session.compact({ sessionID })
      yield* session.resume(sessionID)

      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
        error: { type: "provider.error", message: "summary unavailable" },
      })
    }),
  )

  it.effect("preserves typed provider failures from manual compaction", () =>
    Effect.gen(function* () {
      const session = yield* setup
      response = reply.text("Earlier answer", "text-manual-failure-history")
      yield* admit(session, "Earlier question")
      yield* session.resume(sessionID)

      responseStream = Stream.fail(providerUnavailable())
      const compaction = yield* session.compact({ sessionID })
      yield* session.resume(sessionID)

      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
        error: { type: "provider.transport", message: "Provider unavailable" },
      })
    }),
  )

  it.effect("settles an admitted manual compaction when pre-start resolution throws", () =>
    Effect.gen(function* () {
      const session = yield* setup
      response = reply.text("Earlier answer", "text-manual-resolution-history")
      yield* admit(session, "Earlier question")
      yield* session.resume(sessionID)

      const compaction = yield* session.compact({ sessionID })
      modelResolveHook = Effect.die("model resolution failed")

      expect(yield* Effect.exit(session.resume(sessionID))).toMatchObject({ _tag: "Failure" })

      expect(yield* SessionPending.compaction((yield* Database.Service).db, sessionID)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
        reason: "manual",
      })
      expect(
        (yield* recordedEventTypes(sessionID)).filter(
          (type) => type === EventV2.versionedType(SessionEvent.Compaction.Failed.type, 1),
        ),
      ).toHaveLength(1)
    }),
  )

  it.effect("automatically compacts into a completed summary and retained recent turn", () =>
    Effect.gen(function* () {
      const session = yield* setup
      response = reply.textWithUsage("Earlier answer", "text-first", 3_950)
      yield* admit(session, "Earlier question ".repeat(180))
      yield* session.resume(sessionID)

      currentModel = compactModel
      requests.length = 0
      responses = [
        reply.text("## Objective\n- Preserve the task", "text-summary"),
        reply.textWithUsage("Continued", "text-final", 3_950),
      ]
      yield* admit(session, "Recent exact request ".repeat(180))
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0])[0]).toContain("## Objective")
      expect(userTexts(requests[1])).toHaveLength(1)
      expect(userTexts(requests[1])[0]).toContain("<summary>\n## Objective\n- Preserve the task\n</summary>")
      expect(userTexts(requests[1])[0]).toContain(`[User]: ${"Recent exact request ".repeat(180)}`)

      const context = yield* (yield* SessionStore.Service).context(sessionID)
      expect(context.map((message) => message.type)).toEqual(["compaction", "assistant"])
      expect(context[0]).toMatchObject({
        type: "compaction",
        summary: "## Objective\n- Preserve the task",
      })

      requests.length = 0
      executions.length = 0
      responses = [
        reply.text("## Objective\n- Preserve the updated task", "text-summary-2"),
        reply.text("Continued again", "text-final-2"),
      ]
      yield* admit(session, "Newest exact request ".repeat(180))
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0])[0]).toContain(
        "<previous-summary>\n## Objective\n- Preserve the task\n</previous-summary>",
      )
      expect(userTexts(requests[0])[0]).toContain("Recent exact request")
      expect((yield* (yield* SessionStore.Service).context(sessionID))[0]).toMatchObject({
        type: "compaction",
        summary: "## Objective\n- Preserve the updated task",
      })
    }),
  )

  it.effect("does not compact immediately when the advertised output limit fills the context", () =>
    Effect.gen(function* () {
      const session = yield* setup
      currentModel = fullOutputModel
      response = reply.textWithUsage("Earlier answer", "text-full-output-first", 9_500)
      yield* admit(session, "Earlier question")
      yield* session.resume(sessionID)

      requests.length = 0
      response = reply.text("Continued", "text-full-output-final")
      yield* admit(session, "Continue")
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(userTexts(requests[0])).toContain("Continue")
      expect(yield* session.context(sessionID)).not.toContainEqual(expect.objectContaining({ type: "compaction" }))
    }),
  )

  it.effect("stops after required automatic compaction fails", () =>
    Effect.gen(function* () {
      const session = yield* setup
      response = reply.textWithUsage("Earlier answer", "text-before-failed-compaction", 3_950)
      yield* admit(session, "Earlier question ".repeat(180))
      yield* session.resume(sessionID)

      currentModel = compactModel
      requests.length = 0
      responses = [
        [LLMEvent.providerError({ message: "Unsupported parameter: max_output_tokens" })],
        reply.text("Must not run", "text-after-failed-compaction"),
      ]
      yield* admit(session, "Recent exact request ".repeat(180))
      expect(yield* Effect.exit(session.resume(sessionID))).toMatchObject({ _tag: "Failure" })

      expect(requests).toHaveLength(1)
      expect(requests[0]?.generation).toBeUndefined()
      expect(yield* session.context(sessionID)).toContainEqual(
        expect.objectContaining({
          type: "compaction",
          status: "failed",
          reason: "auto",
          error: expect.objectContaining({ message: "Unsupported parameter: max_output_tokens" }),
        }),
      )
    }),
  )

  it.effect("forces one compaction and retries after provider context overflow", () =>
    Effect.gen(function* () {
      const session = yield* setupOverflowRecovery
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }),
        ],
        reply.text("## Objective\n- Recover overflow", "text-summary"),
        reply.text("Recovered", "text-final"),
      ]
      yield* admit(session, "Continue")
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(3)
      expect(userTexts(requests[1])[0]).toContain("## Objective")
      expect(userTexts(requests[2])[0]).toContain("<summary>\n## Objective\n- Recover overflow\n</summary>")
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "compaction", summary: "## Objective\n- Recover overflow" },
        { type: "assistant", finish: "stop" },
      ])
      yield* replaySessionProjection(sessionID)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "compaction" },
        { type: "assistant", finish: "stop" },
      ])
    }),
  )

  it.effect("recovers from provider context overflow without a configured context limit", () =>
    Effect.gen(function* () {
      const session = yield* setupOverflowRecovery
      currentModel = model
      responses = [
        [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
        reply.text("## Objective\n- Recover unknown limit", "text-summary-unknown-limit"),
        reply.text("Recovered", "text-final-unknown-limit"),
      ]
      yield* admit(session, "Continue")
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(3)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "compaction", summary: "## Objective\n- Recover unknown limit" },
        { type: "assistant", finish: "stop" },
      ])
    }),
  )

  it.effect("recovers from provider context overflow despite an undersized configured context limit", () =>
    Effect.gen(function* () {
      const session = yield* setupOverflowRecovery
      currentModel = undersizedContextModel
      responses = [
        [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
        reply.text("## Objective\n- Recover undersized limit", "text-summary-undersized-limit"),
        reply.text("Recovered", "text-final-undersized-limit"),
      ]
      yield* admit(session, "Continue")
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(3)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "compaction", summary: "## Objective\n- Recover undersized limit" },
        { type: "assistant", finish: "stop" },
      ])
    }),
  )

  it.effect("persists a second context overflow after one recovery", () =>
    Effect.gen(function* () {
      const session = yield* setupOverflowRecovery
      const overflow = () => [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }),
      ]
      responses = [overflow(), reply.text("## Objective\n- Recover once", "text-summary"), overflow()]
      yield* admit(session, "Continue")
      expect((yield* session.resume(sessionID).pipe(Effect.flip)).message).toBe("prompt too long")

      expect(requests).toHaveLength(3)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "compaction" },
        { type: "assistant", finish: "error", error: { message: "prompt too long" } },
      ])
    }),
  )

  it.effect("recovers once from a raw context overflow failure", () =>
    Effect.gen(function* () {
      const session = yield* setupOverflowRecovery
      responseStream = Stream.fail(
        new LLMError({
          module: "test",
          method: "stream",
          reason: new InvalidRequestReason({
            message: "prompt too long",
            classification: "context-overflow",
          }),
        }),
      )
      responses = [
        reply.text("## Objective\n- Recover raw overflow", "text-summary"),
        reply.text("Recovered", "text-final"),
      ]
      yield* admit(session, "Continue")
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(3)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "compaction", summary: "## Objective\n- Recover raw overflow" },
        { type: "assistant", finish: "stop" },
      ])
    }),
  )

  it.effect("publishes the original overflow when recovery summarization fails", () =>
    Effect.gen(function* () {
      const session = yield* setupOverflowRecovery
      responses = [
        [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
        [LLMEvent.providerError({ message: "summary unavailable" })],
      ]
      yield* admit(session, "Continue")
      expect((yield* session.resume(sessionID).pipe(Effect.flip)).message).toBe("prompt too long")

      expect(requests).toHaveLength(2)
      const context = yield* session.context(sessionID)
      expect(context).toContainEqual(
        expect.objectContaining({
          type: "compaction",
          status: "failed",
          reason: "auto",
          error: { type: "provider.error", message: "summary unavailable" },
        }),
      )
      expect(context.slice(-3)).toMatchObject([
        { type: "user", text: "Continue" },
        { type: "compaction", status: "failed", reason: "auto" },
        { type: "assistant", finish: "error", error: { message: "prompt too long" } },
      ])
    }),
  )

  it.effect("interrupts overflow recovery while the summary provider is running", () =>
    Effect.gen(function* () {
      const session = yield* setupOverflowRecovery
      responses = [
        [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
        reply.text("## Objective\n- Interrupted", "text-summary"),
      ]
      const firstGate = yield* Deferred.make<void>()
      const summaryGate = yield* Deferred.make<void>()
      streamGate = firstGate
      yield* admit(session, "Continue")
      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (requests.length < 1) yield* Effect.yieldNow
      streamGate = summaryGate
      yield* Deferred.succeed(firstGate, undefined)
      while (requests.length < 2) yield* Effect.yieldNow

      yield* session.interrupt(sessionID)
      expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
      streamGate = undefined
      expect(requests).toHaveLength(2)
      expect(yield* session.context(sessionID)).toContainEqual(
        expect.objectContaining({ type: "compaction", status: "failed", reason: "auto" }),
      )
    }),
  )

  it.effect("uses epoch values after compaction while a source is unavailable", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      yield* admit(session, "First")

      yield* session.resume(sessionID)
      systemBaseline = "Changed context"
      yield* admit(session, "Second")
      yield* session.resume(sessionID)
      yield* events.publish(SessionEvent.Compaction.Started, {
        sessionID,
        reason: "manual",
        recent: "",
      })
      yield* events.publish(SessionEvent.Compaction.Ended, {
        sessionID,
        reason: "manual",
        text: "summary",
        recent: "",
      })
      systemUnavailable = true
      yield* admit(session, "Third")
      yield* session.resume(sessionID)

      // Compaction already moved current values into the new epoch before the unavailable read.
      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual([defaultSystem, "Changed context"])
      expect(systemTexts(requests.at(-1)!)).not.toContain("Changed context")
    }),
  )

  it.effect("projects reasoning and tool events without executing or continuing tools", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Use tools")

      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "reasoning-1" }),
        LLMEvent.reasoningDelta({ id: "reasoning-1", text: "Think" }),
        LLMEvent.reasoningEnd({ id: "reasoning-1" }),
        LLMEvent.toolInputStart({ id: "call-error", name: "write" }),
        LLMEvent.toolInputDelta({ id: "call-error", name: "write", text: '{"path":"README.md"}' }),
        LLMEvent.toolInputEnd({ id: "call-error", name: "write" }),
        LLMEvent.toolCall({ id: "call-error", name: "write", input: { path: "README.md" }, providerExecuted: true }),
        LLMEvent.toolError({ id: "call-error", name: "write", message: "Denied" }),
        LLMEvent.toolResult({ id: "call-error", name: "write", result: { type: "error", value: "Denied" } }),
        LLMEvent.toolCall({
          id: "call-provider",
          name: "web_search",
          input: { query: "hello" },
          providerExecuted: true,
          providerMetadata: { openai: { source: "provider" } },
        }),
        LLMEvent.toolResult({
          id: "call-provider",
          name: "web_search",
          result: {
            type: "content",
            value: [
              { type: "text", text: "Hello" },
              { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "hello.png" },
            ],
          },
          providerExecuted: true,
          providerMetadata: { openai: { source: "provider" } },
        }),
        LLMEvent.stepFinish({
          index: 0,
          reason: "tool-calls",
          usage: {
            inputTokens: 10,
            nonCachedInputTokens: 8,
            outputTokens: 4,
            reasoningTokens: 1,
            cacheReadInputTokens: 2,
          },
        }),
        LLMEvent.finish({ reason: "tool-calls" }),
      ]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.tools.map((tool) => tool.name)).toEqual(["echo", "defect", "storefail"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Use tools" },
        {
          type: "assistant",
          finish: "tool-calls",
          cost: 0,
          tokens: { input: 8, output: 3, reasoning: 1, cache: { read: 2, write: 0 } },
          content: [
            { type: "reasoning", text: "Think" },
            {
              type: "tool",
              id: "call-error",
              name: "write",
              state: {
                status: "error",
                input: { path: "README.md" },
                error: { type: "tool.execution", message: "Denied" },
              },
            },
            {
              type: "tool",
              id: "call-provider",
              name: "web_search",
              executed: true,
              providerState: { source: "provider" },
              providerResultState: { source: "provider" },
              state: {
                status: "completed",
                input: { query: "hello" },
                structured: {},
                content: [
                  { type: "text", text: "Hello" },
                  { type: "file", mime: "image/png", uri: "data:image/png;base64,aGVsbG8=", name: "hello.png" },
                ],
              },
            },
          ],
        },
      ])
    }),
  )

  it.effect("continues with reloaded history after durably settling one local tool call", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Echo this")

      responses = [reply.tool("call-echo", "echo", { text: "hello" }), reply.text("Done", "text-final")]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
      expect(authorizations).toMatchObject([{ sessionID, callID: "call-echo" }])
      expect(executions).toEqual(["hello"])
      const context = yield* session.context(sessionID)
      expect(context).toMatchObject([
        { type: "user", text: "Echo this" },
        {
          type: "assistant",
          finish: "tool-calls",
          content: [
            {
              type: "tool",
              id: "call-echo",
              name: "echo",
              state: {
                status: "completed",
                input: { text: "hello" },
                structured: { text: "hello" },
                content: [{ type: "text", text: "hello" }],
              },
            },
          ],
        },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Done" }] },
      ])
      const assistant = requireAssistant(context)
      expect((yield* recordedStepSettlementEvents(sessionID, assistant.id)).map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.success.1",
        "session.step.ended.1",
      ])
    }),
  )

  it.effect("reloads a model switch before a tool-driven continuation step", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      yield* admit(session, "Echo this")

      responses = [reply.tool("call-echo", "echo", { text: "hello" }), reply.stop()]
      toolExecutionGate = yield* Deferred.make<void>()
      toolExecutionsStarted = yield* Deferred.make<void>()
      toolExecutionsReady = 1
      const run = yield* Effect.forkChild(session.resume(sessionID))
      yield* Deferred.await(toolExecutionsStarted)
      yield* events.publish(SessionEvent.ModelSelected, {
        sessionID,
        model: { id: ModelV2.ID.make("replacement"), providerID: ProviderV2.ID.make("fake") },
      })
      systemBaseline = "Replacement context"
      yield* Deferred.succeed(toolExecutionGate, undefined)
      yield* Fiber.join(run)

      expect(requests.map((request) => request.model)).toEqual([model, replacementModel])
      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
      ])
      expect(systemTexts(requests[1]!)).toContain("Replacement context")
    }),
  )

  it.effect("restores durable reasoning provider metadata in the next request", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Think first")

      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "reasoning-anthropic" }),
        LLMEvent.reasoningDelta({ id: "reasoning-anthropic", text: "Signed thought" }),
        LLMEvent.reasoningEnd({
          id: "reasoning-anthropic",
          providerMetadata: { openai: { signature: "sig_1" }, anthropic: { ignored: true } },
        }),
        LLMEvent.reasoningStart({
          id: "reasoning-openai",
          providerMetadata: {
            openai: { itemId: "rs_1", reasoningEncryptedContent: null },
            anthropic: { ignored: true },
          },
        }),
        LLMEvent.reasoningDelta({ id: "reasoning-openai", text: "Encrypted thought" }),
        LLMEvent.reasoningEnd({
          id: "reasoning-openai",
          providerMetadata: {
            openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" },
            anthropic: { ignored: true },
          },
        }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]
      yield* session.resume(sessionID)
      yield* replaySessionProjection(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Think first" },
        {
          type: "assistant",
          content: [
            {
              type: "reasoning",
              text: "Signed thought",
              state: { signature: "sig_1" },
            },
            {
              type: "reasoning",
              text: "Encrypted thought",
              state: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" },
            },
          ],
        },
      ])

      yield* admit(session, "Continue")
      response = []
      yield* session.resume(sessionID)

      expect(requests[1]?.messages[1]?.content).toEqual([
        {
          type: "reasoning",
          text: "Signed thought",
          providerMetadata: { openai: { signature: "sig_1" } },
        },
        {
          type: "reasoning",
          text: "Encrypted thought",
          providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
        },
      ])
    }),
  )

  it.effect("replays durable provider-executed tool results inline in the next request", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Search first")

      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({
          id: "hosted-search",
          name: "web_search",
          input: { query: "Effect" },
          providerExecuted: true,
          providerMetadata: { openai: { itemId: "hosted-search" }, fake: { ignored: true } },
        }),
        LLMEvent.toolResult({
          id: "hosted-search",
          name: "web_search",
          result: { type: "json", value: [{ title: "Effect" }] },
          providerExecuted: true,
          providerMetadata: { openai: { blockType: "web_search_tool_result" }, anthropic: { ignored: true } },
        }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]
      yield* session.resume(sessionID)
      yield* replaySessionProjection(sessionID)

      yield* admit(session, "Continue")
      response = []
      yield* session.resume(sessionID)

      expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"])
      expect(requests[1]?.messages[1]?.content).toMatchObject([
        {
          type: "tool-call",
          id: "hosted-search",
          name: "web_search",
          input: { query: "Effect" },
          providerExecuted: true,
          providerMetadata: { openai: { itemId: "hosted-search" } },
        },
        {
          type: "tool-result",
          id: "hosted-search",
          name: "web_search",
          result: { type: "json", value: [{ title: "Effect" }] },
          providerExecuted: true,
          providerMetadata: { openai: { blockType: "web_search_tool_result" } },
        },
      ])
    }),
  )

  it.effect("starts recorded local tools eagerly and awaits settlement before continuing", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Echo five times")

      toolExecutionGate = yield* Deferred.make<void>()
      toolExecutionsStarted = yield* Deferred.make<void>()
      const providerGate = yield* Deferred.make<void>()
      const initial = Stream.fromIterable([
        LLMEvent.stepStart({ index: 0 }),
        ...Array.from({ length: 5 }, (_, index) =>
          LLMEvent.toolCall({ id: `call-echo-${index}`, name: "echo", input: { text: `${index}` } }),
        ),
      ])
      const final = Stream.fromIterable([
        LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
        LLMEvent.finish({ reason: "tool-calls" }),
      ])
      responseStream = Stream.concat(
        initial,
        Stream.fromEffect(Deferred.await(providerGate)).pipe(Stream.flatMap(() => final)),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(toolExecutionsStarted)

      expect(executions).toHaveLength(5)
      expect(maxActiveToolExecutions).toBe(5)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Echo five times" },
        {
          type: "assistant",
          content: Array.from({ length: 5 }, (_, index) => ({
            type: "tool",
            id: `call-echo-${index}`,
            state: { status: "running", input: { text: `${index}` } },
          })),
        },
      ])

      yield* Deferred.succeed(providerGate, undefined)
      yield* Effect.yieldNow
      expect(requests).toHaveLength(1)

      yield* Deferred.succeed(toolExecutionGate, undefined)
      yield* Fiber.join(run)
      toolExecutionGate = undefined
      toolExecutionsStarted = undefined

      expect(executions).toHaveLength(5)
      expect(maxActiveToolExecutions).toBe(5)
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("settles repeated provider-local tool call IDs against their owning assistant messages", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Echo twice")

      responses = [
        reply.tool("tool_0", "echo", { text: "first" }),
        reply.tool("tool_0", "echo", { text: "second" }),
        [],
      ]

      yield* session.resume(sessionID)

      expect(executions).toEqual(["first", "second"])
      expect(requests).toHaveLength(3)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Echo twice" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "tool_0",
              state: { status: "completed", structured: { text: "first" }, content: [{ type: "text", text: "first" }] },
            },
          ],
        },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "tool_0",
              state: {
                status: "completed",
                structured: { text: "second" },
                content: [{ type: "text", text: "second" }],
              },
            },
          ],
        },
      ])

      yield* replaySessionProjection(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Echo twice" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "tool_0",
              state: { status: "completed", structured: { text: "first" }, content: [{ type: "text", text: "first" }] },
            },
          ],
        },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "tool_0",
              state: {
                status: "completed",
                structured: { text: "second" },
                content: [{ type: "text", text: "second" }],
              },
            },
          ],
        },
      ])
    }),
  )

  it.effect("joins concurrent resume calls into one active provider run", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Run once")

      response = reply.text("Once", "text-once")
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      const second = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(requests).toHaveLength(1)
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      streamGate = undefined
      streamStarted = undefined

      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Run once" },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Once" }] },
      ])
    }),
  )

  it.effect("steers an active step with newly recorded prompts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start working")

      responses = [reply.stop(), reply.stop()]
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* session.prompt({ sessionID, text: "Change direction" })
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(first)
      streamGate = undefined
      streamStarted = undefined
      yield* Effect.yieldNow

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0]!)).toEqual(["Start working"])
      expect(userTexts(requests[1]!)).toEqual(["Start working", "Change direction"])
      expect((yield* session.context(sessionID)).map((message) => message.type)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ])
    }),
  )

  it.effect("promotes queued input after continuation ends", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start working")

      responses = [reply.tool("call-echo", "echo", { text: "hello" }), reply.stop(), reply.stop()]
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* session.prompt({
        sessionID,
        text: "Wait until continuation ends",
        delivery: "queue",
      })
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(first)
      streamGate = undefined
      streamStarted = undefined

      expect(requests).toHaveLength(3)
      expect(userTexts(requests[0]!)).toEqual(["Start working"])
      expect(userTexts(requests[1]!)).toEqual(["Start working"])
      expect(userTexts(requests[2]!)).toEqual(["Start working", "Wait until continuation ends"])
    }),
  )

  it.effect("preserves durable queued input for a later wake after interruption", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      yield* admit(session, "Interrupt current work")

      responses = [[], reply.stop()]
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* session.prompt({
        sessionID,
        text: "Run after interrupt",
        delivery: "queue",
      })
      yield* session.interrupt(sessionID)
      expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
      expect(requests).toHaveLength(1)
      expect(yield* SessionPending.has(db, sessionID, "queue")).toBe(true)
      const resumed = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (requests.length < 2) yield* Effect.yieldNow
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(resumed)
      streamGate = undefined
      streamStarted = undefined

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0]!)).toEqual(["Interrupt current work"])
      expect(userTexts(requests[1]!)).toEqual(["Interrupt current work", "Run after interrupt"])
    }),
  )

  it.effect("preserves durable steering input for a later resume after interruption", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      yield* admit(session, "Interrupt current work")

      responses = [[], reply.stop()]
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* session.prompt({
        sessionID,
        text: "Steer after interrupt",
      })
      yield* session.interrupt(sessionID)
      expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
      expect(requests).toHaveLength(1)
      expect(yield* SessionPending.has(db, sessionID, "steer")).toBe(true)

      const resumed = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (requests.length < 2) yield* Effect.yieldNow
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(resumed)
      streamGate = undefined
      streamStarted = undefined

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0]!)).toEqual(["Interrupt current work"])
      expect(userTexts(requests[1]!)).toEqual(["Interrupt current work", "Steer after interrupt"])
    }),
  )

  it.effect("promotes queued inputs one at a time in FIFO order", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start working")

      responses = [reply.stop(), reply.stop(), reply.stop()]
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* session.prompt({ sessionID, text: "Queue first", delivery: "queue" })
      yield* session.prompt({ sessionID, text: "Queue second", delivery: "queue" })
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(first)
      streamGate = undefined
      streamStarted = undefined

      expect(requests).toHaveLength(3)
      expect(userTexts(requests[0]!)).toEqual(["Start working"])
      expect(userTexts(requests[1]!)).toEqual(["Start working", "Queue first"])
      expect(userTexts(requests[2]!)).toEqual(["Start working", "Queue first", "Queue second"])
    }),
  )

  it.effect("promotes queued input after steering continuation ends", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start steering")
      yield* session.prompt({
        sessionID,
        text: "Queue for later",
        delivery: "queue",
        resume: false,
      })

      responses = [reply.stop(), reply.stop()]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0]!)).toEqual(["Start steering"])
      expect(userTexts(requests[1]!)).toEqual(["Start steering", "Queue for later"])
    }),
  )

  it.effect("promotes steers before the next queued input", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start working")

      responses = [reply.stop(), reply.stop(), reply.stop(), reply.stop()]
      const firstGate = yield* Deferred.make<void>()
      const secondGate = yield* Deferred.make<void>()
      streamGate = firstGate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (requests.length < 1) yield* Effect.yieldNow
      yield* session.prompt({ sessionID, text: "Queue first", delivery: "queue" })
      yield* session.prompt({ sessionID, text: "Queue second", delivery: "queue" })
      streamGate = secondGate
      yield* Deferred.succeed(firstGate, undefined)
      while (requests.length < 2) yield* Effect.yieldNow
      yield* session.prompt({ sessionID, text: "Steer before next queued input" })
      yield* session.prompt({
        sessionID,
        text: "Also steer before next queued input",
      })
      yield* session.synthetic({ sessionID, text: "Background completion before next queued input" })
      yield* Deferred.succeed(secondGate, undefined)
      yield* Fiber.join(first)
      streamGate = undefined

      expect(requests).toHaveLength(4)
      expect(userTexts(requests[0]!)).toEqual(["Start working"])
      expect(userTexts(requests[1]!)).toEqual(["Start working", "Queue first"])
      expect(userTexts(requests[2]!)).toEqual([
        "Start working",
        "Queue first",
        "Steer before next queued input",
        "Also steer before next queued input",
        "Background completion before next queued input",
      ])
      expect(userTexts(requests[3]!)).toEqual([
        "Start working",
        "Queue first",
        "Steer before next queued input",
        "Also steer before next queued input",
        "Background completion before next queued input",
        "Queue second",
      ])
    }),
  )

  it.effect("coalesces multiple active steering prompts into one continuation step", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start working")

      responses = [reply.stop(), reply.stop()]
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* session.prompt({ sessionID, text: "First steer" })
      yield* session.prompt({ sessionID, text: "Second steer" })
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(first)
      streamGate = undefined
      streamStarted = undefined
      yield* Effect.yieldNow

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[1]!)).toEqual(["Start working", "First steer", "Second steer"])
      yield* (yield* SessionExecution.Service).wake(sessionID)
      yield* Effect.yieldNow
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("runs steering input accepted while the active step fails", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start working")

      streamFailure = invalidRequest()
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* session.prompt({ sessionID, text: "Recover with this" })
      yield* Deferred.succeed(streamGate, undefined)
      expect(yield* Fiber.join(first).pipe(Effect.flip)).toBe(streamFailure)

      streamFailure = undefined
      streamGate = undefined
      streamStarted = undefined
      yield* Effect.yieldNow

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[1]!)).toEqual(["Start working", "Recover with this"])
    }),
  )

  it.effect("durably fails local tools left running by a prior process before continuing", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      yield* admit(session, "Recover interrupted tool")
      yield* SessionPending.promoteSteers((yield* Database.Service).db, events, sessionID)
      const assistantMessageID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: AgentV2.ID.make("build"),
        model: { id: ModelV2.ID.make("fake-model"), providerID: ProviderV2.ID.make("fake") },
      })
      yield* events.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID,
        callID: "call-interrupted",
        name: "echo",
      })
      yield* events.publish(SessionEvent.Tool.Input.Ended, {
        sessionID,
        assistantMessageID,
        callID: "call-interrupted",
        text: '{"text":"stale"}',
      })
      yield* events.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID,
        callID: "call-interrupted",
        input: { text: "stale" },
        executed: false,
      })
      requests.length = 0
      response = []
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Recover interrupted tool" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-interrupted",
              state: {
                status: "error",
                error: { type: "aborted", message: "Tool execution interrupted: echo" },
              },
            },
          ],
        },
      ])
    }),
  )

  it.effect("durably fails hosted tools left running by a prior process before continuing inline", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      yield* admit(session, "Recover interrupted hosted tool")
      yield* SessionPending.promoteSteers((yield* Database.Service).db, events, sessionID)
      const assistantMessageID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: AgentV2.ID.make("build"),
        model: { id: ModelV2.ID.make("fake-model"), providerID: ProviderV2.ID.make("fake") },
      })
      yield* events.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID,
        callID: "call-hosted-interrupted",
        name: "web_search",
      })
      yield* events.publish(SessionEvent.Tool.Input.Ended, {
        sessionID,
        assistantMessageID,
        callID: "call-hosted-interrupted",
        text: '{"query":"stale"}',
      })
      yield* events.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID,
        callID: "call-hosted-interrupted",
        input: { query: "stale" },
        executed: true,
        state: { itemId: "call-hosted-interrupted" },
      })
      requests.length = 0
      response = []
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.messages.map((message) => message.role)).toEqual(["user", "assistant"])
      expect(requests[0]?.messages[1]?.content).toMatchObject([
        {
          type: "tool-call",
          id: "call-hosted-interrupted",
          providerExecuted: true,
          providerMetadata: { openai: { itemId: "call-hosted-interrupted" } },
        },
        { type: "tool-result", id: "call-hosted-interrupted", providerExecuted: true, result: { type: "error" } },
      ])
    }),
  )

  it.effect("durably fails pending tool input left by a prior process before continuing", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      yield* admit(session, "Recover interrupted tool input")
      yield* SessionPending.promoteSteers((yield* Database.Service).db, events, sessionID)
      const assistantMessageID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: AgentV2.ID.make("build"),
        model: { id: ModelV2.ID.make("fake-model"), providerID: ProviderV2.ID.make("fake") },
      })
      yield* events.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID,
        callID: "call-pending-interrupted",
        name: "echo",
      })
      requests.length = 0
      response = []
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Recover interrupted tool input" },
        { type: "assistant", content: [{ type: "tool", id: "call-pending-interrupted", state: { status: "error" } }] },
      ])
    }),
  )

  it.effect("promotes the first queued input when woken while idle", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* session.prompt({
        sessionID,
        text: "Wait in queue",
        delivery: "queue",
        resume: false,
      })

      yield* (yield* SessionExecution.Service).wake(sessionID)
      while (requests.length === 0) yield* Effect.yieldNow

      expect(requests).toHaveLength(1)
      expect(userTexts(requests[0]!)).toEqual(["Wait in queue"])
    }),
  )

  it.effect("retries inbox input after prompt projection rolls back", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      const defect = new Error("fail after prompt promotion")
      let fail = true
      yield* events.project(SessionEvent.InputPromoted, () => (fail ? Effect.die(defect) : Effect.void))
      yield* admit(session, "Recover promoted input")

      expect(yield* session.resume(sessionID).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
      fail = false
      requests.length = 0
      response = reply.stop()

      yield* (yield* SessionExecution.Service).wake(sessionID)
      while (requests.length === 0) yield* Effect.yieldNow

      expect(userTexts(requests[0]!)).toEqual(["Recover promoted input"])
    }),
  )

  it.effect("does not strand a committed promotion when a post-commit listener defects", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const events = yield* EventV2.Service
      yield* events.listen((event) =>
        event.type === SessionEvent.InputPromoted.type
          ? Effect.die("fail after prompt promotion commits")
          : Effect.void,
      )
      yield* admit(session, "Run committed promotion")

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(userTexts(requests[0]!)).toEqual(["Run committed promotion"])
    }),
  )

  it.effect("adds session correlation headers to model requests", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Run correlated request")

      yield* session.resume(sessionID)

      expect(requests[0]?.http?.headers).toEqual({
        "x-session-affinity": sessionID,
        "X-Session-Id": sessionID,
        "User-Agent": `opencode/${InstallationVersion}`,
        "x-opencode-project": Project.ID.global,
        "x-opencode-session": sessionID,
        "x-opencode-client": Flag.OPENCODE_CLIENT,
      })
    }),
  )

  it.effect("adds the parent session header to child model requests", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const parentID = SessionV2.ID.make("ses_runner_parent")
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: parentID })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* admit(session, "Run child request")

      yield* session.resume(sessionID)

      expect(requests[0]?.http?.headers?.["x-parent-session-id"]).toBe(parentID)
    }),
  )

  it.effect("runs different sessions concurrently", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* insertSession(otherSessionID)
      yield* admit(session, "Run first")
      yield* session.prompt({
        sessionID: otherSessionID,
        text: "Run second",
        resume: false,
      })

      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      streamStarted = yield* Deferred.make<void>()
      const second = yield* session.resume(otherSessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)

      expect(requests).toHaveLength(2)
      expect(requests.map((request) => request.providerOptions?.openai?.promptCacheKey)).toEqual([
        sessionID,
        otherSessionID,
      ])
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      streamGate = undefined
      streamStarted = undefined
    }),
  )

  it.effect("bounds 64-character session prompt cache keys", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const longSessionID = SessionV2.ID.make(`ses_${"a".repeat(64)}`)
      const otherLongSessionID = SessionV2.ID.make(`ses_${"b".repeat(64)}`)
      yield* insertSession(longSessionID)
      yield* insertSession(otherLongSessionID)
      yield* session.prompt({
        sessionID: longSessionID,
        text: "Run long session",
        resume: false,
      })
      yield* session.prompt({
        sessionID: otherLongSessionID,
        text: "Run other long session",
        resume: false,
      })

      yield* session.resume(longSessionID)
      yield* session.resume(otherLongSessionID)

      const keys = requests.map((request) => request.providerOptions?.openai?.promptCacheKey)
      expect(keys).toEqual([longSessionID.slice(4), otherLongSessionID.slice(4)])
      expect(keys.every((key) => typeof key === "string" && key.length === 64)).toBe(true)
      expect(keys[0]).not.toBe(keys[1])
    }),
  )

  it.effect("fans out one failed run and allows a later retry", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Retry after failure")

      streamFailure = invalidRequest()
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      const second = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(requests).toHaveLength(1)
      yield* Deferred.succeed(streamGate, undefined)
      const [firstExit, secondExit] = yield* Effect.all([Fiber.await(first), Fiber.await(second)])
      expect(secondExit).toEqual(firstExit)

      streamFailure = undefined
      streamGate = undefined
      streamStarted = undefined
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("durably settles local tool failures before continuing", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Call missing")

      responses = [reply.tool("call-missing", "missing", {}), reply.text("Recovered", "text-after-error")]
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Call missing" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-missing",
              state: {
                status: "error",
                error: { type: "tool.unknown", message: "Unknown tool: missing" },
              },
            },
          ],
        },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Recovered" }] },
      ])
    }),
  )

  it.effect("returns unexpected local tool defects to the model and continues", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Call defect")

      responses = [reply.tool("call-defect", "defect", {}), reply.text("Recovered", "text-after-defect")]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
      const context = yield* session.context(sessionID)
      expect(context).toMatchObject([
        { type: "user", text: "Call defect" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-defect",
              state: {
                status: "error",
                error: { type: "unknown", message: "unexpected tool defect" },
              },
            },
          ],
        },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Recovered" }] },
      ])
      const assistant = requireAssistant(context)
      expect((yield* recordedStepSettlementEvents(sessionID, assistant.id)).map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.1",
        "session.step.ended.1",
      ])
    }),
  )

  it.effect("returns tool-wrapped policy blocks to the model and continues", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        blocked: Tool.make({
          description: "Fail because policy blocked execution",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () =>
            Effect.fail(new PermissionV2.BlockedError({ rules: [], permission: "blocked", resources: ["*"] })).pipe(
              Effect.mapError(() => new Tool.Failure({ message: "Permission blocked" })),
            ),
        }),
      }, { codemode: false })
      yield* admit(session, "Call blocked")

      responses = [reply.tool("call-blocked", "blocked", {}), reply.stop()]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Call blocked" },
        {
          type: "assistant",
          content: [
            { type: "tool", id: "call-blocked", state: { status: "error", error: { message: "Permission blocked" } } },
          ],
        },
        { type: "assistant", finish: "stop" },
      ])
    }),
  )

  it.effect("interrupts runner continuation when permission approval is declined", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        declined: Tool.make({
          description: "Fail because the user declined approval",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.die(new PermissionV2.DeclinedError()),
        }),
      }, { codemode: false })
      yield* admit(session, "Call declined")

      response = reply.tool("call-declined", "declined", {})

      const exit = yield* session.resume(sessionID).pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Call declined" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-declined",
              state: { status: "error", error: { message: "Tool execution interrupted" } },
            },
          ],
        },
      ])
    }),
  )

  it.effect("returns permission corrections to the model and continues", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        corrected: Tool.make({
          description: "Fail with user correction feedback",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () =>
            Effect.fail(new PermissionV2.CorrectedError({ feedback: "Use another tool" })).pipe(
              Effect.mapError(() => new Tool.Failure({ message: "Use another tool" })),
            ),
        }),
      }, { codemode: false })
      yield* admit(session, "Call corrected")

      responses = [reply.tool("call-corrected", "corrected", {}), reply.stop()]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Call corrected" },
        {
          type: "assistant",
          content: [
            { type: "tool", id: "call-corrected", state: { status: "error", error: { message: "Use another tool" } } },
          ],
        },
        { type: "assistant", finish: "stop" },
      ])
    }),
  )

  it.effect("fails the drain when tool output persistence fails", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Call storefail")

      responses = [reply.tool("call-storefail", "storefail", {}), []]

      const exit = yield* session.resume(sessionID).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Call storefail" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-storefail",
              state: {
                status: "error",
                error: {
                  type: "unknown",
                  message: expect.stringContaining("Failed to encode tool output"),
                },
              },
            },
          ],
          finish: "error",
          error: { type: "unknown", message: expect.stringContaining("Failed to encode tool output") },
        },
      ])
    }),
  )

  it.effect("returns configured permission denials to the model and continues", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* ToolRegistry.Service
      yield* registry.register({ permissionfail: permissionFail }, { codemode: false })
      yield* admit(session, "Reject permission")
      responses = [
        reply.tool("call-permission", "permissionfail", {}),
        [LLMEvent.stepStart({ index: 0 }), LLMEvent.stepFinish({ index: 0, reason: "stop" })],
      ]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-permission",
              state: {
                status: "error",
                error: {
                  type: "permission.rejected",
                  message: "Permission denied: edit",
                },
              },
            },
          ],
        },
        { type: "assistant", finish: "stop" },
      ])
      expect(yield* recordedEventTypes(sessionID)).not.toContain("session.step.failed.1")
    }),
  )

  it.effect("interrupts runner continuation when a question is cancelled", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        question: Tool.make({
          description: "Ask the user",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.die(new QuestionTool.CancelledError()),
        }),
      }, { codemode: false })
      yield* admit(session, "Ask then stop")

      responses = [reply.tool("call-question", "question", {}), []]

      const run = yield* session.resume(sessionID).pipe(Effect.exit, Effect.forkChild)
      const exit = yield* Fiber.join(run)

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Ask then stop" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-question",
              state: { status: "error", error: { type: "aborted", message: "Tool execution interrupted" } },
            },
          ],
        },
      ])
    }),
  )

  it.effect("awaits started local tools before surfacing provider stream failure", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Settle before failing")
      const failure = providerUnavailable()
      toolExecutionGate = yield* Deferred.make<void>()
      responseStream = Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-before-failure", name: "echo", input: { text: "settle" } }),
        ]),
        Stream.fail(failure),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (executions.length === 0) yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Deferred.succeed(toolExecutionGate, undefined)
      expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)
      toolExecutionGate = undefined

      const context = yield* session.context(sessionID)
      expect(context).toMatchObject([
        { type: "user", text: "Settle before failing" },
        {
          type: "assistant",
          content: [
            { type: "tool", id: "call-before-failure", state: { status: "completed", structured: { text: "settle" } } },
          ],
        },
      ])
      const assistant = requireAssistant(context)
      expect((yield* recordedStepSettlementEvents(sessionID, assistant.id)).map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.success.1",
        "session.step.failed.1",
      ])
    }),
  )

  it.effect("durably fails blocked local tools when a step is interrupted", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Interrupt blocked tool")
      toolExecutionGate = yield* Deferred.make<void>()
      responseStream = Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-before-interrupt", name: "echo", input: { text: "blocked" } }),
        ]),
        Stream.never,
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (executions.length === 0) yield* Effect.yieldNow
      yield* session.interrupt(sessionID)
      toolExecutionGate = undefined

      expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
      yield* session.interrupt(sessionID)
      const context = yield* session.context(sessionID)
      expect(context).toMatchObject([
        { type: "user", text: "Interrupt blocked tool" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-before-interrupt",
              state: { status: "error", error: { type: "aborted", message: "Tool execution interrupted" } },
            },
          ],
        },
      ])
      const assistant = requireAssistant(context)
      expect((yield* recordedStepSettlementEvents(sessionID, assistant.id)).map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.1",
        "session.step.failed.1",
      ])

      yield* replaySessionProjection(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Interrupt blocked tool" },
        { type: "assistant", content: [{ type: "tool", id: "call-before-interrupt", state: { status: "error" } }] },
      ])
      requests.length = 0
      responseStream = undefined
      response = []
      yield* session.resume(sessionID)
      expect(requests[0]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
    }),
  )

  it.effect("interrupts a blocked step without local tool execution", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Interrupt provider")
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* session.interrupt(sessionID)
      const exit = yield* Fiber.await(run)
      streamGate = undefined
      streamStarted = undefined

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Interrupt provider" },
        { type: "assistant", finish: "error", error: { type: "aborted", message: "Step interrupted" } },
      ])
      expect(yield* recordedEventTypes(sessionID)).toContain("session.step.failed.1")
      yield* session.interrupt(sessionID)
    }),
  )

  it.effect("durably fails blocked local tools when interrupted while awaiting settlement", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Interrupt tool settlement")
      toolExecutionGate = yield* Deferred.make<void>()
      toolExecutionsStarted = yield* Deferred.make<void>()
      toolExecutionsReady = 1
      response = reply.tool("call-await-interrupt", "echo", { text: "blocked" })

      const runner = yield* SessionRunner.Service
      const run = yield* runner.drain({ sessionID, force: true }).pipe(Effect.forkChild)
      yield* Deferred.await(toolExecutionsStarted)
      yield* Fiber.interrupt(run)
      toolExecutionGate = undefined

      expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Interrupt tool settlement" },
        {
          type: "assistant",
          finish: "error",
          error: { type: "aborted", message: "Step interrupted" },
          content: [
            {
              type: "tool",
              id: "call-await-interrupt",
              state: { status: "error", error: { type: "aborted", message: "Tool execution interrupted" } },
            },
          ],
        },
      ])
      const eventTypes = yield* recordedEventTypes(sessionID)
      expect(eventTypes).toContain("session.step.failed.1")
      expect(eventTypes).not.toContain("session.step.ended.1")
    }),
  )

  it.effect("forces a text response on an agent's configured final step", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.steps = 2
        }),
      )
      yield* admit(session, "Finish at the limit")

      responses = [
        reply.tool("call-terminal", "echo", { text: "done" }),
        reply.tool("call-forbidden", "echo", { text: "forbidden" }),
      ]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(requests[0]?.toolChoice).toBeUndefined()
      expect(requests[1]?.toolChoice).toMatchObject({ type: "none" })
      expect(requests[1]?.tools).toEqual([])
      expect(requests[1]?.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: expect.stringContaining("MAXIMUM STEPS REACHED") }],
      })
      expect(executions).toEqual(["done"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Finish at the limit" },
        { type: "assistant", content: [{ type: "tool", id: "call-terminal", state: { status: "completed" } }] },
        { type: "assistant", content: [{ type: "tool", id: "call-forbidden", state: { status: "error" } }] },
      ])
    }),
  )

  it.effect("resets the configured step allowance when steering input promotes", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.steps = 2
        }),
      )
      yield* admit(session, "Start work")

      responses = [
        reply.tool("call-before-steer", "echo", { text: "before" }),
        reply.tool("call-after-steer", "echo", { text: "after" }),
        reply.stop(),
      ]
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      yield* session.prompt({ sessionID, text: "Change direction" })
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(run)
      streamGate = undefined
      streamStarted = undefined

      expect(requests).toHaveLength(3)
      expect(requests[1]?.toolChoice).toBeUndefined()
      expect(requests[1]?.tools).not.toEqual([])
      expect(requests[2]?.toolChoice).toMatchObject({ type: "none" })
      expect(executions).toEqual(["before", "after"])
    }),
  )

  it.effect("projects provider errors as terminal assistant step failures", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Fail durably")

      response = [LLMEvent.stepStart({ index: 0 }), LLMEvent.providerError({ message: "Provider unavailable" })]

      expect((yield* session.resume(sessionID).pipe(Effect.flip)).message).toBe("Provider unavailable")

      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail durably" },
        { type: "assistant", finish: "error", error: { type: "provider.unknown", message: "Provider unavailable" } },
      ])
    }),
  )

  it.effect("projects provider errors emitted before assistant step start", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Fail before step")

      response = [LLMEvent.providerError({ message: "Provider unavailable" })]

      expect((yield* session.resume(sessionID).pipe(Effect.flip)).message).toBe("Provider unavailable")

      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail before step" },
        { type: "assistant", finish: "error", error: { type: "provider.unknown", message: "Provider unavailable" } },
      ])
    }),
  )

  it.effect("projects content-filter finishes as visible terminal failures", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Blocked response")
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "partial" }),
        LLMEvent.textDelta({ id: "partial", text: "Partial" }),
        LLMEvent.stepFinish({
          index: 0,
          reason: "content-filter",
          usage: { nonCachedInputTokens: 8, outputTokens: 3, reasoningTokens: 1 },
        }),
        LLMEvent.finish({ reason: "content-filter" }),
      ]

      expect((yield* session.resume(sessionID).pipe(Effect.flip)).message).toBe("Provider blocked the response")
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        {
          type: "assistant",
          finish: "error",
          error: { type: "provider.content-filter" },
          cost: 0,
          tokens: { input: 8, output: 2, reasoning: 1, cache: { read: 0, write: 0 } },
          content: [{ type: "text", text: "Partial" }],
        },
      ])
      expect(yield* session.get(sessionID)).toMatchObject({
        cost: 0,
        tokens: { input: 8, output: 2, reasoning: 1, cache: { read: 0, write: 0 } },
      })
      expect(yield* recordedEventTypes(sessionID)).not.toContain("session.step.ended.1")
    }),
  )

  it.effect("settles a local tool before one content-filter step failure", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Tool before blocked response")
      toolExecutionGate = yield* Deferred.make<void>()
      toolExecutionsStarted = yield* Deferred.make<void>()
      toolExecutionsReady = 1
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-before-content-filter", name: "echo", input: { text: "settled" } }),
        LLMEvent.stepFinish({ index: 0, reason: "content-filter" }),
        LLMEvent.finish({ reason: "content-filter" }),
      ]

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(toolExecutionsStarted)
      yield* Deferred.succeed(toolExecutionGate, undefined)
      expect((yield* Fiber.join(run).pipe(Effect.flip)).message).toBe("Provider blocked the response")
      toolExecutionGate = undefined
      toolExecutionsStarted = undefined

      const assistant = requireAssistant(yield* session.context(sessionID))
      const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(events.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.success.1",
        "session.step.failed.1",
      ])
      expect(
        events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
      ).toHaveLength(1)
    }),
  )

  it.effect("does not recover context overflow after durable assistant output", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Fail after output")

      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-partial" }),
        LLMEvent.textDelta({ id: "text-partial", text: "Partial" }),
        LLMEvent.textEnd({ id: "text-partial" }),
        LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }),
      ]
      expect((yield* session.resume(sessionID).pipe(Effect.flip)).message).toBe("prompt too long")

      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail after output" },
        {
          type: "assistant",
          finish: "error",
          error: { message: "prompt too long" },
          content: [{ type: "text", text: "Partial" }],
        },
      ])
    }),
  )

  it.effect("projects raw provider stream failures as terminal assistant step failures", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Fail raw stream durably")
      const failure = invalidRequest()
      responseStream = Stream.fail(failure)

      expect(yield* session.resume(sessionID).pipe(Effect.flip)).toBe(failure)
      yield* replaySessionProjection(sessionID)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail raw stream durably" },
        { type: "assistant", finish: "error", error: { type: "provider.invalid-request", message: "Invalid request" } },
      ])
    }),
  )

  it.effect("retries eligible pre-output failures after exponential backoff", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Retry transport")
      responseStream = Stream.fail(providerUnavailable())
      response = reply.text("Recovered", "retry-success")

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (requests.length < 1) yield* Effect.yieldNow
      yield* TestClock.adjust("1999 millis")
      expect(requests).toHaveLength(1)
      yield* TestClock.adjust("1 millis")
      yield* Fiber.join(run)

      expect(requests).toHaveLength(2)
      const eventTypes = yield* recordedEventTypes(sessionID)
      expect(eventTypes).toContain("session.retry.scheduled.1")
      expect(eventTypes.filter((type) => type === "session.step.started.1")).toHaveLength(2)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Recovered" }] },
      ])
      yield* replaySessionProjection(sessionID)
      expect((yield* session.context(sessionID)).filter((message) => message.type === "assistant")).toHaveLength(1)
    }),
  )

  it.effect("uses a larger provider retry-after delay", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Retry rate limit")
      responseStream = Stream.fail(rateLimited(5_000))
      response = reply.text("Recovered", "retry-after-success")

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (requests.length < 1) yield* Effect.yieldNow
      yield* TestClock.adjust("4999 millis")
      expect(requests).toHaveLength(1)
      yield* TestClock.adjust("1 millis")
      yield* Fiber.join(run)
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("does not retry eligible failures after observable output", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Do not replay partial output")
      const failure = rateLimited()
      responseStream = Stream.fromIterable([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "partial-rate-limit" }),
        LLMEvent.textDelta({ id: "partial-rate-limit", text: "Partial" }),
      ]).pipe(Stream.concat(Stream.fail(failure)))

      expect(yield* session.resume(sessionID).pipe(Effect.flip)).toBe(failure)
      expect(requests).toHaveLength(1)
      expect(yield* recordedEventTypes(sessionID)).not.toContain("session.retry.scheduled.1")
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        {
          type: "assistant",
          finish: "error",
          error: { type: "provider.rate-limit" },
          content: [{ type: "text", text: "Partial" }],
        },
      ])
    }),
  )

  it.effect("stops after five total retry attempts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Exhaust retries")
      streamFailure = providerUnavailable()

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (requests.length < 1) yield* Effect.yieldNow
      for (const [index, delay] of [2_000, 4_000, 8_000, 16_000].entries()) {
        yield* TestClock.adjust(delay)
        while (requests.length < index + 2) yield* Effect.yieldNow
      }
      expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(streamFailure)
      expect(requests).toHaveLength(5)

      const database = (yield* Database.Service).db
      const retries = yield* database
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.type, "session.retry.scheduled.1"))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      expect(retries.map((event) => event.data)).toMatchObject([
        { attempt: 2, at: 2_000 },
        { attempt: 3, at: 6_000 },
        { attempt: 4, at: 14_000 },
        { attempt: 5, at: 30_000 },
      ])
      expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.step.started.1")).toHaveLength(5)
      const assistant = requireAssistant(yield* session.context(sessionID))
      expect(yield* recordedStepSettlementEvents(sessionID, assistant.id)).toMatchObject([
        { type: "session.step.started.1" },
        { type: "session.step.started.1" },
        { type: "session.step.started.1" },
        { type: "session.step.started.1" },
        { type: "session.step.started.1" },
        { type: "session.step.failed.1" },
      ])
    }),
  )

  it.effect("retries a physical attempt without consuming the logical agent step", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.steps = 2
        }),
      )
      yield* admit(session, "Retry without consuming a step")
      const failure = providerUnavailable()
      responseStream = Stream.fail(failure)
      responses = [reply.tool("call-after-retry", "echo", { text: "recovered" }), reply.stop()]

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      while (requests.length < 1) yield* Effect.yieldNow
      yield* TestClock.adjust("2 seconds")
      yield* Fiber.join(run)

      expect(requests).toHaveLength(3)
      expect(requests[0]?.toolChoice).toBeUndefined()
      expect(requests[0]?.tools.map((tool) => tool.name)).toContain("echo")
      expect(requests[1]?.toolChoice).toBeUndefined()
      expect(requests[1]?.tools.map((tool) => tool.name)).toContain("echo")
      expect(requests[1]?.messages.at(-1)).not.toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: expect.stringContaining("MAXIMUM STEPS REACHED") }],
      })
      expect(requests[2]?.toolChoice).toMatchObject({ type: "none" })
      expect(requests[2]?.tools).toEqual([])
      expect(requests[2]?.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: expect.stringContaining("MAXIMUM STEPS REACHED") }],
      })
      expect(executions).toEqual(["recovered"])
      const eventTypes = yield* recordedEventTypes(sessionID)
      expect(eventTypes.filter((type) => type === "session.step.started.1")).toHaveLength(3)
      expect(eventTypes.filter((type) => type === "session.retry.scheduled.1")).toHaveLength(1)
      expect((yield* session.context(sessionID)).filter((message) => message.type === "assistant")).toHaveLength(2)
    }),
  )

  it.effect("does not retry non-eligible provider failures", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Do not retry")
      const failure = invalidRequest()
      streamFailure = failure

      expect(yield* session.resume(sessionID).pipe(Effect.flip)).toBe(failure)
      expect(requests).toHaveLength(1)
      expect(yield* recordedEventTypes(sessionID)).not.toContain("session.retry.scheduled.1")
    }),
  )

  it.effect("settles malformed streamed tool input before the provider failure", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Call a malformed tool")
      const failure = new LLMError({
        module: "test",
        method: "stream",
        reason: new InvalidProviderOutputReason({ message: "Invalid JSON input for tool call echo" }),
      })
      responseStream = Stream.fromIterable([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id: "call-malformed", name: "echo" }),
        LLMEvent.toolInputDelta({ id: "call-malformed", name: "echo", text: '{"text":"partial' }),
      ]).pipe(Stream.concat(Stream.fail(failure)))

      expect(yield* session.resume(sessionID).pipe(Effect.flip)).toBe(failure)
      const assistant = requireAssistant(yield* session.context(sessionID))

      response = reply.stop()
      yield* admit(session, "Continue")
      yield* session.resume(sessionID)

      expect(yield* recordedStepSettlementEvents(sessionID, assistant.id)).toMatchObject([
        { type: "session.step.started.1" },
        {
          type: "session.tool.failed.1",
          data: {
            callID: "call-malformed",
            error: { type: "provider.invalid-output", message: "Invalid JSON input for tool call echo" },
          },
        },
        {
          type: "session.step.failed.1",
          data: { error: { type: "provider.invalid-output", message: "Invalid JSON input for tool call echo" } },
        },
      ])
    }),
  )

  it.effect("does not continue automatically after a provider error follows a local tool call", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Do not continue failed provider")

      toolExecutionGate = yield* Deferred.make<void>()
      toolExecutionsStarted = yield* Deferred.make<void>()
      toolExecutionsReady = 1
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-before-provider-error", name: "echo", input: { text: "settled" } }),
        LLMEvent.providerError({ message: "Provider unavailable" }),
      ]

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(toolExecutionsStarted)
      yield* Deferred.succeed(toolExecutionGate, undefined)
      expect((yield* Fiber.join(run).pipe(Effect.flip)).message).toBe("Provider unavailable")
      toolExecutionGate = undefined
      toolExecutionsStarted = undefined

      expect(requests).toHaveLength(1)
      expect(executions).toEqual(["settled"])
      const context = yield* session.context(sessionID)
      const assistant = requireAssistant(context)
      expect((yield* recordedStepSettlementEvents(sessionID, assistant.id)).map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.success.1",
        "session.step.failed.1",
      ])
    }),
  )

  it.effect("durably fails a hosted tool when its provider errors before returning a result", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Fail hosted tool durably")

      response = [
        LLMEvent.stepStart({ index: 0 }),
        hostedCall("call-hosted-provider-error", "effect"),
        LLMEvent.providerError({ message: "Provider unavailable" }),
      ]

      expect((yield* session.resume(sessionID).pipe(Effect.flip)).message).toBe("Provider unavailable")

      expect(requests).toHaveLength(1)
      const context = yield* session.context(sessionID)
      expect(context).toMatchObject([
        { type: "user", text: "Fail hosted tool durably" },
        {
          type: "assistant",
          content: [{ type: "tool", id: "call-hosted-provider-error", state: { status: "error" } }],
        },
      ])
      const assistant = requireAssistant(context)
      expect((yield* recordedStepSettlementEvents(sessionID, assistant.id)).map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.1",
        "session.step.failed.1",
      ])
    }),
  )

  it.effect("preserves a tool defect before provider failure settlement", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Defect while provider fails")
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-defect-provider-error", name: "defect", input: {} }),
        LLMEvent.providerError({ message: "Provider unavailable" }),
      ]

      expect((yield* session.resume(sessionID).pipe(Effect.flip)).message).toBe("Provider unavailable")

      const context = yield* session.context(sessionID)
      const assistant = requireAssistant(context)
      const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(events.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.1",
        "session.step.failed.1",
      ])
      expect(events[2]?.data.error).toMatchObject({ type: "unknown", message: "unexpected tool defect" })
    }),
  )

  it.effect("durably fails a hosted tool left unresolved at normal provider EOF", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Fail hosted tool at EOF")
      response = [LLMEvent.stepStart({ index: 0 }), hostedCall("call-hosted-eof", "effect")]

      expect((yield* session.resume(sessionID).pipe(Effect.flip)).message).toBe("Provider did not return a tool result")
      const assistant = requireAssistant(yield* session.context(sessionID))
      const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(events.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.1",
        "session.step.failed.1",
      ])
      expect(
        events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
      ).toHaveLength(1)
      yield* replaySessionProjection(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail hosted tool at EOF" },
        {
          type: "assistant",
          finish: "error",
          error: { type: "tool.result-missing" },
          content: [{ type: "tool", id: "call-hosted-eof", state: { status: "error" } }],
        },
      ])
    }),
  )

  it.effect("fails an unresolved hosted tool before one clean step end", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Settle hosted tool before ending")
      response = [
        LLMEvent.stepStart({ index: 0 }),
        hostedCall("call-hosted-clean-end", "effect"),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]

      yield* session.resume(sessionID)

      const assistant = requireAssistant(yield* session.context(sessionID))
      const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(events.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.1",
        "session.step.ended.1",
      ])
      expect(
        events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
      ).toHaveLength(1)
    }),
  )

  it.effect("settles unresolved local and hosted tools before one raw provider failure", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Fail unresolved tools")
      const failure = invalidRequest()
      const providerFailed = yield* Deferred.make<void>()
      toolExecutionGate = yield* Deferred.make<void>()
      responseStream = Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-local-raw-failure", name: "defect", input: {} }),
          hostedCall("call-hosted-raw-failure-pair", "effect"),
        ]),
        Stream.fromEffect(Deferred.succeed(providerFailed, undefined)).pipe(Stream.flatMap(() => Stream.fail(failure))),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(providerFailed)
      yield* Deferred.succeed(toolExecutionGate, undefined)
      expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)
      toolExecutionGate = undefined

      const assistant = requireAssistant(yield* session.context(sessionID))
      const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(events.map((event) => ({ type: event.type, callID: event.data.callID }))).toEqual([
        { type: "session.step.started.1", callID: undefined },
        { type: "session.tool.called.1", callID: "call-local-raw-failure" },
        { type: "session.tool.called.1", callID: "call-hosted-raw-failure-pair" },
        { type: "session.tool.failed.1", callID: "call-local-raw-failure" },
        { type: "session.tool.failed.1", callID: "call-hosted-raw-failure-pair" },
        { type: "session.step.failed.1", callID: undefined },
      ])
      expect(
        events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
      ).toHaveLength(1)
    }),
  )

  it.effect("durably fails a hosted tool left unresolved by a raw provider stream failure", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Fail hosted tool on raw failure")
      const failure = providerUnavailable()
      responseStream = Stream.concat(
        Stream.fromIterable([LLMEvent.stepStart({ index: 0 }), hostedCall("call-hosted-raw-failure", "effect")]),
        Stream.fail(failure),
      )

      expect(yield* session.resume(sessionID).pipe(Effect.flip)).toBe(failure)
      expect(requests).toHaveLength(1)
      const assistant = requireAssistant(yield* session.context(sessionID))
      const events = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(events.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.1",
        "session.step.failed.1",
      ])
      expect(
        events.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
      ).toHaveLength(1)
      yield* replaySessionProjection(sessionID)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail hosted tool on raw failure" },
        {
          type: "assistant",
          finish: "error",
          error: { type: "provider.transport", message: "Provider unavailable" },
          content: [{ type: "tool", id: "call-hosted-raw-failure", state: { status: "error" } }],
        },
      ])
    }),
  )

  it.effect("rejects a second text start before the open fragment ends", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Two blocks")

      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-1" }),
        LLMEvent.textStart({ id: "text-2" }),
      ]

      const defect = yield* session.resume(sessionID).pipe(Effect.catchDefect(Effect.succeed))
      expect(defect).toBeInstanceOf(Error)
      if (!(defect instanceof Error)) return
      expect(defect.message).toBe("text start before end: text-2")
    }),
  )

  it.effect("projects sequential text fragments as separate content parts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Two blocks")

      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-1" }),
        LLMEvent.textDelta({ id: "text-1", text: "First" }),
        LLMEvent.textEnd({ id: "text-1" }),
        LLMEvent.textStart({ id: "text-2" }),
        LLMEvent.textDelta({ id: "text-2", text: "Second" }),
        LLMEvent.textEnd({ id: "text-2" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]

      yield* session.resume(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Two blocks" },
        {
          type: "assistant",
          content: [
            { type: "text", text: "First" },
            { type: "text", text: "Second" },
          ],
        },
      ])
    }),
  )

  for (const kind of fragmentKinds) {
    it.effect(`broadcasts provider ${kind} deltas without storing projection rewrites`, () =>
      verifyEphemeralDeltas(kind),
    )

    it.effect(`durably closes partial ${kind} when the provider stream fails`, () => verifyPartialFlushOnFailure(kind))

    it.effect(`durably closes partial ${kind} when the provider stream is interrupted`, () =>
      verifyPartialFlushOnInterruption(kind),
    )
  }

  it.effect("rejects duplicate streamed text starts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      response = [LLMEvent.textStart({ id: "text-1" }), LLMEvent.textStart({ id: "text-1" })]

      const defect = yield* session.resume(sessionID).pipe(Effect.catchDefect(Effect.succeed))
      expect(defect).toBeInstanceOf(Error)
      if (!(defect instanceof Error)) return
      expect(defect.message).toBe("Duplicate text start: text-1")
    }),
  )

  it.effect("transitions streamed raw tool input to parsed called input", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Call provider tool")

      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id: "call-parsed", name: "web_search" }),
        LLMEvent.toolInputDelta({ id: "call-parsed", name: "web_search", text: '{"query":"hello"}' }),
        LLMEvent.toolInputEnd({ id: "call-parsed", name: "web_search" }),
        hostedCall("call-parsed", "hello"),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]

      yield* session.resume(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Call provider tool" },
        {
          type: "assistant",
          content: [{ type: "tool", id: "call-parsed", state: { status: "error", input: { query: "hello" } } }],
        },
      ])
    }),
  )

  it.effect("rejects malformed streamed tool input ordering", () =>
    Effect.gen(function* () {
      const session = yield* setup
      response = [LLMEvent.toolInputDelta({ id: "call-1", name: "read", text: "{}" })]

      const defect = yield* session.resume(sessionID).pipe(Effect.catchDefect(Effect.succeed))
      expect(defect).toBeInstanceOf(Error)
      if (!(defect instanceof Error)) return
      expect(defect.message).toBe("Tool input delta before start: call-1")
    }),
  )
})
