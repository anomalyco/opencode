import { describe, expect, test } from "bun:test"
import {
  AIError,
  LLMEvent,
  LLMRequest,
  Message,
  LanguageModel,
  SystemPart,
  ToolFailure,
  TransportReason,
  InvalidProviderOutputReason,
  InvalidRequestReason,
  RateLimitReason,
} from "@opencode-ai/ai"
import * as OpenAIChat from "@opencode-ai/ai/protocols/openai-chat"
import { TestLLM } from "@opencode-ai/ai/testing"
import { Catalog } from "@opencode-ai/core/catalog"
import { Database } from "@opencode-ai/core/database/database"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Event } from "@opencode-ai/schema/event"
import { App } from "@opencode-ai/core/app"
import { Permission } from "@opencode-ai/core/permission"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Form } from "@opencode-ai/core/form"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionContext } from "@opencode-ai/core/session/context"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionModelRequest } from "@opencode-ai/core/session/model-request"
import { SessionModelTransport } from "@opencode-ai/core/session/model-transport"
import { Money } from "@opencode-ai/schema/money"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner/index"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { PromptCacheDiagnostics } from "@opencode-ai/core/session/prompt-cache-diagnostics"
import { SessionUsage } from "@opencode-ai/core/session/usage"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { SystemPromptPlugin } from "@opencode-ai/core/plugin/system-prompt"
import { QuestionTool } from "@opencode-ai/core/tool/plugin/question"
import { Agent } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { Document, Info } from "@opencode-ai/schema/config"
import { ConfigCompaction } from "@opencode-ai/schema/config/compaction"
import { Tool } from "@opencode-ai/core/tool"
import type { Info as ToolInfo } from "@opencode-ai/schema/tool"
import {
  InstructionStateTable,
  SessionInboxTable,
  SessionMessageTable,
  SessionTable,
} from "@opencode-ai/core/session/sql"
import { InstructionEntry } from "@opencode-ai/core/session/instruction-entry"
import { InstructionState } from "@opencode-ai/core/session/instruction-state"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Instructions } from "@opencode-ai/core/instructions/index"
import { InstructionBuiltIns } from "@opencode-ai/core/instructions/builtins"
import { InstructionDiscovery } from "@opencode-ai/core/instruction-discovery"
import { SkillInstructions } from "@opencode-ai/core/skill/instructions"
import { ReferenceInstructions } from "@opencode-ai/core/reference/instructions"
import { McpInstructions } from "@opencode-ai/core/mcp/instructions"
import { SessionSystemPrompt } from "@opencode-ai/core/session/system-prompt"
import { ID } from "@opencode-ai/core/model"
import { Location } from "@opencode-ai/core/location"
import { Provider } from "@opencode-ai/core/provider"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { asc, desc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { agentHost, catalogHost, host } from "./plugin/host"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"

let requests: LLMRequest[] = []
const emptyCodeMode = `\n\n${CodeModeInstructions.render({ total: 0, shown: 0, namespaces: [] })}`
type ToolBarrier = {
  readonly count: number
  readonly started: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
  active: number
  maxActive: number
}
let toolBarrier: ToolBarrier | undefined
const releaseTools = (barrier: ToolBarrier) =>
  Effect.sync(() => {
    if (toolBarrier === barrier) toolBarrier = undefined
  }).pipe(Effect.andThen(Deferred.succeed(barrier.release, undefined)), Effect.asVoid)
const blockTools = (count = 1) =>
  Effect.acquireRelease(
    Effect.all({ started: Deferred.make<void>(), release: Deferred.make<void>() }).pipe(
      Effect.map((deferreds) => {
        const barrier = { count, ...deferreds, active: 0, maxActive: 0 }
        toolBarrier = barrier
        return barrier
      }),
    ),
    releaseTools,
  ).pipe(
    Effect.map((barrier) => ({
      started: Deferred.await(barrier.started),
      release: releaseTools(barrier),
      maxActive: Effect.sync(() => barrier.maxActive),
    })),
  )
const awaitToolBarrier = Effect.suspend(() => {
  const barrier = toolBarrier
  if (!barrier) return Effect.void
  barrier.active++
  barrier.maxActive = Math.max(barrier.maxActive, barrier.active)
  return (barrier.active === barrier.count ? Deferred.succeed(barrier.started, undefined) : Effect.void).pipe(
    Effect.andThen(Deferred.await(barrier.release)),
    Effect.ensuring(Effect.sync(() => barrier.active--)),
  )
})
const testLLM = TestLLM.layer({
  fallback: [],
  transformRequest: (request) =>
    LLMRequest.update(request, {
      system: request.system.map((part) => ({
        ...part,
        text: part.text.replace(emptyCodeMode, ""),
      })),
      tools: request.tools.filter((tool) => tool.name !== "execute"),
    }),
})
const client = TestLLM.clientLayer
const closedTransports: Session.ID[] = []
const modelTransport = Layer.succeed(
  SessionModelTransport.Service,
  SessionModelTransport.Service.of({
    bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
    close: (sessionID) => Effect.sync(() => closedTransports.push(sessionID)),
    closeAll: Effect.void,
  }),
)
type ModelLimit = { readonly context: number; readonly input?: number; readonly output: number }
const defaultModelLimit = { context: 200_000, output: 32_000 }
const modelLimits = new Map<string, ModelLimit>()
const testModel = (id: string, limit: ModelLimit = defaultModelLimit) => {
  modelLimits.set(id, limit)
  return LanguageModel.make({ id, provider: "fake", route: OpenAIChat.route })
}
const model = testModel("fake-model")
const defaultSystem = SessionSystemPrompt.make([])
const replacementModel = testModel("replacement")
const compactModel = testModel("compact", { context: 4_000, output: 50 })
const fullOutputModel = testModel("full-output", { context: 262_144, output: 262_144 })
const undersizedContextModel = testModel("undersized-context", { context: 1, output: 1_000 })
const recoveryModel = testModel("recovery", { context: 20_000, output: 1_000 })

test("calculates step cost using the matching context tier", () => {
  expect(
    SessionUsage.calculateCost(
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

test("ignores malformed model cost fields", () => {
  const costs = [
    {
      input: Money.USDPerMillionTokens.make(3),
      output: Money.USDPerMillionTokens.make(15),
      cache: {
        read: Money.USDPerMillionTokens.make(0.3),
        write: Money.USDPerMillionTokens.make(3.75),
      },
    },
  ]
  Object.assign(costs[0], { input: {} })

  expect(
    SessionUsage.calculateCost(costs, {
      input: 1_000_000,
      output: 100_000,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    }),
  ).toBe(Money.USD.make(1.5))
})

test("does not apply an ineligible tier without base pricing", () => {
  expect(
    SessionUsage.calculateCost(
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
const permissionFail = {
  name: "permission_fail",
  description: "Reject a permission",
  input: Schema.Struct({}),
  output: Schema.Struct({}),
  execute: () =>
    new ToolFailure({
      message: "Permission denied: edit",
      error: new Permission.BlockedError({
        rules: [],
        permission: "edit",
        resources: ["src/index.ts"],
      }),
    }),
}
const permission = permissionLayer()
const transformTools = (registry: Tool.Interface, tools: Readonly<Record<string, ToolInfo>>, options?: Tool.Options) =>
  registry.transform((draft) =>
    Object.entries(tools).forEach(([name, tool]) => draft.add({ ...tool, name, options: options ?? tool.options })),
  )
const echo = Layer.effectDiscard(
  Tool.Service.use((registry) =>
    transformTools(
      registry,
      {
        echo: {
          name: "echo",
          description: "Echo text",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.Struct({ text: Schema.String }),
          execute: ({ text }, context) =>
            Effect.gen(function* () {
              authorizations.push(context)
              executions.push(text)
              yield* awaitToolBarrier
              return { output: { text }, content: text }
            }),
        },
        defect: {
          name: "defect",
          description: "Fail unexpectedly",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => awaitToolBarrier.pipe(Effect.andThen(Effect.die("unexpected tool defect"))),
        },
        storefail: {
          name: "storefail",
          description: "Produce output that cannot be persisted",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.succeed({ output: {} }),
        },
      },
      { codemode: false },
    ),
  ),
)
const echoNode = makeLocationNode({ name: "test/session-runner-tools", layer: echo, deps: [Tool.node] })
let modelResolveHook = Effect.void
let currentModel = model
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: (session) =>
    modelResolveHook.pipe(
      Effect.map(() => {
        const selected = session.model?.id === "replacement" ? replacementModel : currentModel
        return SessionRunnerModel.resolved(selected, {
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
          cost: [],
          limit: modelLimits.get(String(selected.id)) ?? defaultModelLimit,
          variant: session.model?.variant,
        })
      }),
    ),
})
const systemContextKey = Instructions.Key.make("test/context")
let systemBaseline = "Initial context"
let systemRemoved = false
let systemUnavailable = false
let systemLoadHook = Effect.void
const skillBaselines = new Map<Agent.ID, string>()
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
const instructionContext = Layer.mock(InstructionDiscovery.Service, {
  project: true,
  load: () => Effect.succeed(Instructions.empty),
})
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
const config = Config.testLayer([
  new Document({
    type: "document",
    info: new Info({
      compaction: new ConfigCompaction.Info({
        buffer: 3_000,
        keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
      }),
    }),
  }),
])
let pluginFlushHook = Effect.void
const pluginSupervisor = Layer.succeed(
  PluginSupervisor.Service,
  PluginSupervisor.Service.of({
    flush: Effect.suspend(() => pluginFlushHook),
  }),
)
const promptCatalog = Layer.mock(Catalog.Service, {
  provider: {
    get: () => Effect.undefined,
    all: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
  },
  model: {
    get: () => Effect.undefined,
    all: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
    default: () => Effect.undefined,
    small: () => Effect.undefined,
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
  [Permission.node, permission],
  [Config.node, config],
  [McpInstructions.node, mcpInstructions],
  [PluginSupervisor.node, pluginSupervisor],
  [SessionModelTransport.node, modelTransport],
])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    function drain(
      sessionID: Session.ID,
      force: boolean,
      continuation?: SessionRunner.Continuation,
    ): Effect.Effect<void, SessionRunner.RunError> {
      return sessionRunner
        .drain({ sessionID, force, continuation })
        .pipe(
          Effect.flatMap((result) =>
            result.type === "complete" ? Effect.void : drain(sessionID, false, result.continuation),
          ),
        )
    }
    const coordinator = yield* SessionRunCoordinator.make<Session.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => drain(sessionID, force),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: (sessionID) => coordinator.interrupt(sessionID),
      awaitIdle: coordinator.awaitIdle,
    })
  }),
).pipe(Layer.provide(runnerLayer))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Form.node,
      SessionProjector.node,
      SessionStore.node,
      Agent.node,
      Catalog.node,
      Tool.node,
      Tool.node,
      PluginHooks.node,
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
      SessionContext.node,
      SessionModelRequest.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      Session.node,
    ]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [LayerNodePlatform.llmClient, client],
      [Permission.node, permission],
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
      [PluginSupervisor.node, pluginSupervisor],
      [SessionModelTransport.node, modelTransport],
    ],
  ).pipe(Layer.provideMerge(testLLM)),
)
const sessionID = Session.ID.make("ses_runner_test")
const otherSessionID = Session.ID.make("ses_runner_other")
const admit = (session: Session.Interface, text: string) => session.prompt({ sessionID, text, resume: false })
const runPrompt = Effect.fnUntraced(function* (session: Session.Interface, text: string) {
  const message = yield* admit(session, text)
  yield* session.resume(sessionID)
  return message
})

const insertSession = (id: Session.ID) =>
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
  const agents = yield* Agent.Service
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
  requests = (yield* TestLLM.Service).requests
  authorizations.length = 0
  executions.length = 0
  closedTransports.length = 0
  systemBaseline = "Initial context"
  systemRemoved = false
  systemUnavailable = false
  systemLoadHook = Effect.void
  modelResolveHook = Effect.void
  pluginFlushHook = Effect.void
  currentModel = model
  skillBaselines.clear()
  toolBarrier = undefined
  yield* agents.transform((draft) =>
    draft.update(Agent.ID.make("build"), (agent) => {
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
  return yield* Session.Service
})

const providerUnavailable = () =>
  new AIError({
    module: "test",
    method: "stream",
    reason: new TransportReason({
      message: "Provider unavailable",
      transport: "http",
      operation: "request",
    }),
  })

const streamDisconnected = () =>
  new AIError({
    module: "test",
    method: "stream",
    reason: new TransportReason({
      message: "The socket connection was closed unexpectedly",
      transport: "http",
      operation: "read",
    }),
  })

const continuationRejected = (recovery: "retry-full" | "rotate-and-retry-full") =>
  new AIError({
    module: "test",
    method: "stream",
    reason: new TransportReason({
      message: "Continuation rejected",
      transport: "websocket",
      operation: "read",
      phase: "receive",
      delivery: "rejected",
      recovery,
    }),
  })

const incompleteStream = () =>
  new AIError({
    module: "test",
    method: "stream",
    reason: new InvalidProviderOutputReason({
      classification: "incomplete-stream",
      message: "The provider response ended unexpectedly.",
    }),
  })

const INCOMPLETE_STREAM_CONTINUATION =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

const invalidRequest = () =>
  new AIError({
    module: "test",
    method: "stream",
    reason: new InvalidRequestReason({ message: "Invalid request" }),
  })

const rateLimited = (retryAfterMs?: number) =>
  new AIError({
    module: "test",
    method: "stream",
    reason: new RateLimitReason({ message: "Rate limited", retryAfterMs }),
  })

const setupOverflowRecovery = Effect.gen(function* () {
  const session = yield* setup
  yield* TestLLM.push(TestLLM.text("Earlier answer", "text-earlier"))
  yield* runPrompt(session, "Earlier question ".repeat(700))
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
const messageRoles = (request: LLMRequest | undefined) => request?.messages.map((message) => message.role)

const recordedEventTypes = (id: Session.ID) =>
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

const recordedStepSettlementEvents = (id: Session.ID, assistantMessageID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const settlementTypes = new Set([
      "session.step.started.1",
      "session.tool.called.1",
      "session.tool.success.2",
      "session.tool.failed.2",
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

const recordedStepSettlementTypes = (id: Session.ID, assistantMessageID: SessionMessage.ID) =>
  recordedStepSettlementEvents(id, assistantMessageID).pipe(Effect.map((events) => events.map((event) => event.type)))

const hostedCall = (id: string, query: string) =>
  LLMEvent.toolCall({ id, name: "web_search", input: { query }, providerExecuted: true })

const requireAssistant = (messages: readonly SessionMessage.Info[]) => {
  const assistant = messages.find((message) => message.type === "assistant")
  if (!assistant) throw new Error("Assistant message missing")
  return assistant
}

const replaySessionProjection = (id: Session.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const bus = yield* Bus.Service
    const recorded = yield* db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, id))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)

    yield* bus.remove(id)
    yield* db.delete(InstructionStateTable).where(eq(InstructionStateTable.session_id, id)).run().pipe(Effect.orDie)
    yield* db.delete(SessionInboxTable).where(eq(SessionInboxTable.session_id, id)).run().pipe(Effect.orDie)
    yield* db.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, id)).run().pipe(Effect.orDie)
    yield* Effect.forEach(
      recorded.map((event) => ({
        id: event.id,
        created: event.created,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      })),
      (event) => bus.replay(event),
      { discard: true },
    )
  })

type FragmentKind = "text" | "reasoning" | "tool input"

type FragmentFixture = {
  readonly delta?: Event.Definition
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
          LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
          LLMEvent.finish({ reason: { normalized: "stop" } }),
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
          LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
          LLMEvent.finish({ reason: { normalized: "stop" } }),
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
    const bus = yield* Bus.Service
    const live = fixture.delta
      ? yield* bus.subscribe(fixture.delta).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      : undefined
    yield* Effect.yieldNow
    yield* TestLLM.push(fixture.completeEvents)

    yield* session.resume(sessionID)

    const { db } = yield* Database.Service
    const deltas = fixture.delta
      ? yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.type, Bus.versionedType(fixture.delta.type, 1)))
          .all()
          .pipe(Effect.orDie)
      : []
    if (live) {
      const streamed = Array.from(yield* Fiber.join(live))
      expect(streamed).toHaveLength(1)
      expect(
        streamed
          .map((event) => {
            if (!event.data || typeof event.data !== "object" || !("delta" in event.data))
              throw new Error("Expected delta event")
            if (typeof event.data.delta !== "string") throw new Error("Expected string delta")
            return event.data.delta
          })
          .join(""),
      ).toBe(chunks.join(""))
    }
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
    yield* TestLLM.push(TestLLM.failAfter(failure, ...fixture.partialEvents))

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
    yield* TestLLM.push(
      Stream.concat(
        Stream.fromIterable(fixture.partialEvents),
        Stream.fromEffect(Deferred.succeed(streamed, undefined)).pipe(Stream.flatMap(() => Stream.never)),
      ),
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

const prepareTitleGeneration = Effect.gen(function* () {
  const agents = yield* Agent.Service
  const { db } = yield* Database.Service
  yield* db.update(SessionTable).set({ title: null }).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
  yield* agents.transform((draft) =>
    draft.update(Agent.ID.make("title"), (agent) => {
      agent.mode = "primary"
      agent.hidden = true
      agent.system = "Generate a title."
    }),
  )
})

const watchRename = Effect.fnUntraced(function* (sessionID: Session.ID) {
  const bus = yield* Bus.Service
  return yield* bus.subscribe(SessionEvent.Renamed).pipe(
    Stream.filter((event) => event.data.sessionID === sessionID),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  )
})

describe("SessionRunnerLLM", () => {
  it.effect("generates the title while the first model step is still running", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* prepareTitleGeneration

      yield* admit(session, "First prompt")
      yield* TestLLM.push(TestLLM.text("Generated title", "text-title"), Stream.never)
      const renamed = yield* watchRename(sessionID)
      const runner = yield* SessionRunner.Service
      const fiber = yield* runner.drain({ sessionID, force: true }).pipe(Effect.forkChild)
      yield* Fiber.join(renamed)

      expect((yield* session.get(sessionID)).title).toBe("Generated title")
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect("coalesces title generation while a request is active", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* prepareTitleGeneration

      const titleStarted = yield* Deferred.make<void>()
      const releaseTitle = yield* Deferred.make<void>()
      yield* Effect.gen(function* () {
        yield* admit(session, "First prompt")
        yield* TestLLM.push(
          Stream.unwrap(
            Deferred.succeed(titleStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseTitle)),
              Effect.as(Stream.fromIterable(TestLLM.text("Generated title", "text-title"))),
            ),
          ),
          TestLLM.text("First response", "text-first"),
          TestLLM.text("Second response", "text-second"),
        )

        const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
        yield* Deferred.await(titleStarted).pipe(Effect.timeout("5 seconds"))
        expect(requests[0]?.system.map((part) => part.text)).toContain("Generate a title.")
        yield* Fiber.join(first)
        yield* admit(session, "Second prompt")
        yield* session.resume(sessionID)

        expect(requests).toHaveLength(3)
        const renamed = yield* watchRename(sessionID)
        yield* Deferred.succeed(releaseTitle, undefined)
        yield* Fiber.join(renamed)
        expect((yield* session.get(sessionID)).title).toBe("Generated title")
      }).pipe(Effect.ensuring(Deferred.succeed(releaseTitle, undefined)))
    }),
  )

  it.effect("retries title generation from the first prompt after title and execution failures", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* prepareTitleGeneration

      yield* admit(session, "First prompt")
      yield* TestLLM.push(Stream.fail(invalidRequest()), Stream.fail(invalidRequest()))
      expect((yield* session.resume(sessionID).pipe(Effect.exit))._tag).toBe("Failure")

      yield* admit(session, "Second prompt")
      const titleFailed = yield* Deferred.make<void>()
      yield* TestLLM.push(
        Stream.make(LLMEvent.providerError({ message: "Title provider unavailable" })).pipe(
          Stream.ensuring(Deferred.succeed(titleFailed, undefined)),
        ),
        TestLLM.text("Recovered", "text-recovered"),
      )
      yield* session.resume(sessionID)
      yield* Deferred.await(titleFailed)
      yield* Effect.yieldNow
      expect((yield* session.get(sessionID)).title).toBeUndefined()

      const renamed = yield* watchRename(sessionID)
      yield* admit(session, "Third prompt")
      yield* TestLLM.push(
        TestLLM.text("Generated title", "text-title"),
        TestLLM.text("Recovered again", "text-recovered-again"),
      )
      yield* session.resume(sessionID)
      yield* Fiber.join(renamed)

      expect(requests).toHaveLength(6)
      expect(requests[2]?.messages).toContainEqual(Message.user("First prompt"))
      expect(requests[4]?.messages).toContainEqual(Message.user("First prompt"))
      expect((yield* session.get(sessionID)).title).toBe("Generated title")
    }),
  )

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
      yield* TestLLM.push(TestLLM.tool("call-removed", "echo", { text: "blocked" }))

      yield* session.resume(sessionID)

      // A hook-removed call fails independently and continues while step allowance remains.
      expect(requests).toHaveLength(2)
      expect(requests[0]?.system.map((part) => part.text)).toEqual(["Hooked system"])
      expect(requests[0]?.messages).toEqual([Message.user("Hooked message")])
      expect(requests[0]?.tools.map((tool) => tool.name)).not.toContain("echo")
      expect(requests[0]?.tools.map((tool) => tool.name)).not.toContain("unregistered")
      expect(executions).toEqual([])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Original message" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-removed",
              state: { status: "error", error: { type: "tool.execution" } },
            },
          ],
        },
      ])
    }),
  )

  it.effect("keeps WebSocket eligibility after model request hooks", () =>
    Effect.gen(function* () {
      yield* setup
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("session", "model.request", (event) =>
        Effect.sync(() => {
          event.headers["x-model-request-hook"] = "active"
        }),
      )
      yield* hooks.register("session", "http.request", () => Effect.die("Other-provider HTTP hook should not apply"), {
        providerID: Provider.ID.githubCopilot,
      })
      const context = yield* SessionContext.Service
      const modelRequests = yield* SessionModelRequest.Service
      const selected = yield* context.select(sessionID)
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      yield* InstructionState.prepare(database.db, bus, selected.instructions, sessionID)
      const loaded = yield* context.load(selected)

      const prepared = yield* modelRequests.prepare({
        scope: {
          session: loaded.session,
          agentID: loaded.agent.id,
          model: loaded.model,
          tools: loaded.tools,
        },
        transcript: { system: [], messages: [] },
        webSocket: "session",
      })

      expect(prepared.request.http?.headers?.["x-model-request-hook"]).toBe("active")
      // No forced HTTP middleware: the other-provider hook must not revoke eligibility.
      expect(prepared.options.http).toBeUndefined()
    }),
  )

  it.effect("forces HTTP and triggers active request and response hooks once", () =>
    Effect.gen(function* () {
      yield* setup
      const hooks = yield* PluginHooks.Service
      let requestTriggers = 0
      let responseTriggers = 0
      yield* hooks.register("session", "http.request", (event) =>
        Effect.sync(() => {
          requestTriggers++
          event.request.headers.set("x-request-hook", "active")
        }),
      )
      yield* hooks.register("session", "http.response", (event) =>
        Effect.sync(() => {
          responseTriggers++
          event.response.headers.set("x-response-hook", "active")
        }),
      )
      const context = yield* SessionContext.Service
      const modelRequests = yield* SessionModelRequest.Service
      const selected = yield* context.select(sessionID)
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      yield* InstructionState.prepare(database.db, bus, selected.instructions, sessionID)
      const loaded = yield* context.load(selected)
      const prepared = yield* modelRequests.prepare({
        scope: {
          session: loaded.session,
          agentID: loaded.agent.id,
          model: loaded.model,
          tools: loaded.tools,
        },
        transcript: { system: [], messages: [] },
        webSocket: "session",
      })
      const http = prepared.options.http ?? (yield* Effect.die("Expected Session HTTP middleware"))

      const response = yield* http(HttpClientRequest.post("https://provider.test/responses"), (request) => {
        expect(request.headers["x-request-hook"]).toBe("active")
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("network")))
      })

      expect(prepared.options.webSocket).toBeUndefined()
      expect(response.headers["x-response-hook"]).toBe("active")
      expect(requestTriggers).toBe(1)
      expect(responseTriggers).toBe(1)
    }),
  )

  it.effect("executes a tool renamed by a session context hook", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("session", "context", (event) =>
        Effect.sync(() => {
          event.tools.renamed_echo = event.tools.echo!
          delete event.tools.echo
        }),
      )
      yield* admit(session, "Use the renamed tool")
      yield* TestLLM.push(TestLLM.tool("call-renamed", "renamed_echo", { text: "renamed" }), [])

      yield* session.resume(sessionID)

      expect(requests[0]?.tools.map((tool) => tool.name)).toContain("renamed_echo")
      expect(requests[0]?.tools.map((tool) => tool.name)).not.toContain("echo")
      expect(executions).toEqual(["renamed"])
    }),
  )

  it.effect("advertises and executes a location registered tool", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* Tool.Service
      const contexts: Tool.Context[] = []
      yield* transformTools(
        registry,
        {
          location_context: {
            name: "location_context",
            description: "Read application context",
            input: Schema.Struct({ query: Schema.String }),
            output: Schema.Struct({ answer: Schema.String }),
            execute: ({ query }, context) =>
              Effect.gen(function* () {
                contexts.push(context)
                yield* context.progress({ phase: "reading" })
                return { output: { answer: query.toUpperCase() } }
              }),
          },
        },
        { codemode: false },
      )
      yield* admit(session, "Use application context")
      yield* TestLLM.push(TestLLM.tool("call-location", "location_context", { query: "hello" }), [])
      const bus = yield* Bus.Service
      const progressFiber = yield* bus.subscribe(SessionEvent.Tool.Progress).pipe(
        Stream.filter((event) => event.data.sessionID === sessionID && event.data.id === "call-location"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      )

      yield* session.resume(sessionID)

      expect(requests[0]?.tools.map((tool) => tool.name)).toContain("location_context")
      expect(contexts).toEqual([
        {
          sessionID,
          agent: Agent.ID.make("build"),
          messageID: expect.stringMatching(/^msg_/),
          id: Tool.CallID.make("call-location"),
          progress: expect.any(Function),
        },
      ])
      expect(Array.from(yield* Fiber.join(progressFiber))[0]?.data.metadata).toEqual({ phase: "reading" })
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Use application context" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-location",
              state: { status: "completed", content: [{ type: "text", text: '{"answer":"HELLO"}' }] },
            },
          ],
        },
      ])
    }),
  )

  it.effect("executes the tool advertised before a registry reload", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* Tool.Service
      const scope = yield* Scope.make()
      const executions: string[] = []
      yield* transformTools(
        registry,
        {
          reloaded: {
            name: "reloaded",
            description: "Record the advertised tool",
            input: Schema.Struct({}),
            output: Schema.Struct({ value: Schema.String }),
            execute: () =>
              Effect.sync(() => executions.push("advertised")).pipe(Effect.as({ output: { value: "advertised" } })),
          },
        },
        { codemode: false },
      ).pipe(Scope.provide(scope))
      yield* admit(session, "Use the reloaded tool")
      yield* TestLLM.push(TestLLM.tool("call-reloaded", "reloaded", {}), [])
      const stream = yield* TestLLM.gate

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* Scope.close(scope, Exit.void)
      yield* transformTools(
        registry,
        {
          reloaded: {
            name: "reloaded",
            description: "Record the replacement tool",
            input: Schema.Struct({}),
            output: Schema.Struct({ value: Schema.String }),
            execute: () =>
              Effect.sync(() => executions.push("replacement")).pipe(Effect.as({ output: { value: "replacement" } })),
          },
        },
        { codemode: false },
      )
      yield* stream.release
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
              state: { status: "completed", content: [{ type: "text", text: '{"value":"advertised"}' }] },
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
      yield* TestLLM.push(
        Stream.fromIterable(TestLLM.tool("call-echo", "echo", { text: "background started" })),
        Stream.unwrap(
          Deferred.succeed(secondStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseSecond)),
            Effect.as(Stream.fromIterable(TestLLM.stop())),
          ),
        ),
        Stream.fromIterable(TestLLM.text("Handled completion", "text-completion")),
      )
      yield* admit(session, "Start background work")
      const running = yield* session.resume(sessionID).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(secondStarted)

      yield* session.synthetic({ sessionID, text: "Background work completed" })
      yield* Deferred.succeed(releaseSecond, undefined)
      yield* Fiber.join(running)

      expect(requests).toHaveLength(3)
      expect(userTexts(requests[2])).toContain("Background work completed")
    }),
  )

  it.effect("streams one request with registry definitions from chronological user history", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "First")
      yield* runPrompt(session, "Second")

      expect(requests).toHaveLength(1)
      expect(requests[0]?.model).toBe(model)
      expect(requests[0]?.tools.map((tool) => tool.name)).toEqual(["defect", "echo", "storefail"])
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
      const bus = yield* Bus.Service
      const instructionEvents: Event.Payload[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.sync(() => {
          if (event.type === "session.instructions.updated") instructionEvents.push(event)
        }),
      )
      yield* runPrompt(session, "First")
      systemBaseline = "Changed context"
      yield* runPrompt(session, "Second")
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
      expect(yield* SessionInbox.has(db, sessionID, "steer")).toBe(true)
      expect(
        yield* db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).get(),
      ).toBeUndefined()

      systemUnavailable = false
      yield* session.prompt({ id: messageID, sessionID, text: "First" })
      yield* session.wait(sessionID)

      expect(requests).toHaveLength(1)
      expect(messageRoles(requests[0])).toEqual(["user"])
    }),
  )

  it.effect("preserves instruction state and interrupts the source Location runner after a Session moves", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      yield* runPrompt(session, "First")
      const instructionState = yield* db
        .select()
        .from(InstructionStateTable)
        .where(eq(InstructionStateTable.session_id, sessionID))
        .get()

      yield* bus.publish(SessionEvent.Moved, {
        sessionID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/moved") }),
        projectID: Project.ID.global,
      })
      expect(
        yield* db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).get(),
      ).toEqual(instructionState)

      yield* admit(session, "Second")
      const exit = yield* session.resume(sessionID).pipe(Effect.exit)

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(requests).toHaveLength(1)
      expect(yield* SessionInbox.has(db, sessionID, "steer")).toBe(true)
    }),
  )

  it.effect("delivers a queued move atomically at the idle boundary", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const inboxID = SessionMessage.ID.create()
      yield* SessionInbox.admit(db, bus, {
        id: inboxID,
        sessionID,
        item: {
          type: "move",
          payload: {
            location: Location.Ref.make({ directory: AbsolutePath.make("/moved") }),
            projectID: Project.ID.global,
          },
          delivery: "queue",
        },
      })

      yield* session.resume(sessionID)

      expect((yield* session.get(sessionID)).location.directory).toBe(AbsolutePath.make("/moved"))
      expect(yield* session.inbox(sessionID)).toEqual([])
      expect(requests).toEqual([])
      expect(closedTransports).toEqual([sessionID])
      expect(
        (yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, sessionID))
          .orderBy(desc(EventTable.seq))
          .limit(2)
          .all()).map((event) => event.type),
      ).toEqual([Bus.versionedType(SessionEvent.Moved.type, 1), Bus.versionedType(SessionEvent.InboxDelivered.type, 1)])
    }),
  )

  it.effect("preserves a tool continuation across a steered move", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      yield* admit(session, "Echo before moving")
      yield* TestLLM.push(
        TestLLM.tool("call-move", "echo", { text: "moving" }),
        TestLLM.text("Done", "text-after-move"),
      )
      const tools = yield* blockTools()
      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* tools.started
      yield* SessionInbox.admit(db, bus, {
        id: SessionMessage.ID.create(),
        sessionID,
        item: {
          type: "move",
          payload: {
            location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
            projectID: Project.ID.global,
          },
          delivery: "steer",
        },
      })

      yield* tools.release
      yield* Fiber.join(run)

      expect(requests).toHaveLength(2)
      expect(requests.map(messageRoles).at(1)?.slice(0, 3)).toEqual(["user", "assistant", "tool"])
      expect(yield* session.inbox(sessionID)).toEqual([])
    }),
  )

  it.effect("keeps queued input parked across a mid-turn move", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      yield* admit(session, "Echo before moving")
      yield* TestLLM.push(
        TestLLM.tool("call-move", "echo", { text: "moving" }),
        TestLLM.text("Done", "text-after-move"),
        TestLLM.text("Handled queue", "text-after-queue"),
      )
      const tools = yield* blockTools()
      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* tools.started
      yield* session.prompt({ sessionID, text: "Queued for later", delivery: "queue", resume: false })
      yield* SessionInbox.admit(db, bus, {
        id: SessionMessage.ID.create(),
        sessionID,
        item: {
          type: "move",
          payload: {
            location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
            projectID: Project.ID.global,
          },
          delivery: "steer",
        },
      })

      yield* tools.release
      yield* Fiber.join(run)

      // The resumed turn absorbs steers only; queued input waits for the turn to end.
      expect(requests).toHaveLength(3)
      expect(userTexts(requests[1])).not.toContain("Queued for later")
      expect(userTexts(requests[2])).toContain("Queued for later")
    }),
  )

  it.effect("seeds a fork with the parent's newest instruction values", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* runPrompt(session, "First")
      systemBaseline = "Changed context"
      const second = yield* runPrompt(session, "Second")
      systemBaseline = "Latest context"
      yield* runPrompt(session, "Third")

      const forked = yield* session.fork({ sessionID, boundary: { type: "before", messageID: second.id } })
      expect(
        yield* (yield* Database.Service).db
          .select()
          .from(InstructionStateTable)
          .where(eq(InstructionStateTable.session_id, forked.id))
          .get(),
      ).toMatchObject({
        initial_values: { "test/context": Instructions.hash("Latest context") },
        current_values: { "test/context": Instructions.hash("Latest context") },
      })
      yield* session.prompt({ sessionID: forked.id, text: "Forked", resume: false })
      yield* session.resume(forked.id)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual([defaultSystem, "Latest context"])
      // Copied history keeps the frozen chronological update; no new update is emitted.
      expect(systemTexts(requests.at(-1)!)).toContain("Changed context")
      expect(systemTexts(requests.at(-1)!)).not.toContain("Latest context")

      const { db } = yield* Database.Service
      const bus = yield* Bus.Service
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, forked.id))
        .orderBy(asc(EventTable.seq))
        .all()
      yield* bus.remove(forked.id)
      yield* db.delete(SessionTable).where(eq(SessionTable.id, forked.id)).run()
      yield* Effect.forEach(
        recorded.map((event) => ({
          id: event.id,
          created: event.created,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
        (event) => bus.replay(event),
        { discard: true },
      )
      expect(
        yield* db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, forked.id)).get(),
      ).toMatchObject({ current_values: { "test/context": Instructions.hash("Latest context") } })
    }),
  )

  it.effect("keeps nested forks self-contained", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* runPrompt(session, "First")
      systemBaseline = "Changed context"
      const second = yield* runPrompt(session, "Second")

      const child = yield* session.fork({ sessionID, boundary: { type: "before", messageID: second.id } })
      const inheritedFirst = (yield* session.messages({ sessionID: child.id })).find(
        (message) => message.type === "user" && message.text === "First",
      )
      if (!inheritedFirst) return yield* Effect.die(new Error("Nested fork boundary message not found"))
      const grandchild = yield* session.fork({
        sessionID: child.id,
        boundary: { type: "before", messageID: inheritedFirst.id },
      })

      expect(
        yield* (yield* Database.Service).db
          .select()
          .from(InstructionStateTable)
          .where(eq(InstructionStateTable.session_id, grandchild.id))
          .get(),
      ).toMatchObject({
        initial_values: { "test/context": Instructions.hash("Changed context") },
        current_values: { "test/context": Instructions.hash("Changed context") },
      })
      return undefined
    }),
  )

  it.effect("re-establishes a fresh baseline when instruction state is missing", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      yield* runPrompt(session, "First")
      yield* db.delete(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).run()
      yield* admit(session, "Second")
      requests.length = 0

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.system.map((part) => part.text)).toEqual([defaultSystem, "Initial context"])
      expect(messageRoles(requests[0])).toEqual(["user", "user"])
      // The projected row is authoritative: a missing row admits a fresh baseline
      // instead of rebuilding from durable events.
      expect(
        yield* db
          .select({ data: EventTable.data })
          .from(EventTable)
          .where(eq(EventTable.type, "session.instructions.updated.2"))
          .all(),
      ).toHaveLength(2)
      expect(yield* db.select().from(InstructionStateTable).get()).toMatchObject({
        initial_values: { "test/context": Instructions.hash("Initial context") },
        current_values: { "test/context": Instructions.hash("Initial context") },
      })
    }),
  )

  it.effect("keeps the initial instructions stable and derives a chronological update from values", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* runPrompt(session, "First")
      systemBaseline = "Changed context"
      yield* runPrompt(session, "Second")

      expect(
        PromptCacheDiagnostics.compare(
          PromptCacheDiagnostics.snapshot(requests[0]),
          PromptCacheDiagnostics.snapshot(requests[1]),
        ),
      ).toEqual({ status: "append-only", previousMessages: 1, currentMessages: 3 })
      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
      ])
      expect(messageRoles(requests[1])).toEqual(["user", "system", "user"])
      expect(requests[1]?.messages.at(1)?.content).toEqual([{ type: "text", text: "Changed context" }])
      // The chronological update is a durable client-visible system message.
      const messages = yield* session.messages({ sessionID })
      expect(messages).toHaveLength(3)
      expect(messages[1]).toMatchObject({ type: "system", text: "Changed context" })
      const { db } = yield* Database.Service
      const updates = yield* db
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.type, "session.instructions.updated.2"))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      expect(updates).toHaveLength(2)
      expect(updates[0]?.data).toMatchObject({
        sessionID,
        delta: { "test/context": Instructions.hash("Initial context") },
      })
      expect(updates[1]?.data).toEqual({
        sessionID,
        delta: { "test/context": Instructions.hash("Changed context") },
        text: "Changed context",
      })
      yield* replaySessionProjection(sessionID)
      expect(yield* session.messages({ sessionID })).toHaveLength(3)
    }),
  )

  it.effect("uses the selected model family prompt when the agent does not override it", () =>
    Effect.gen(function* () {
      const session = yield* setup
      currentModel = LanguageModel.make({ id: "gpt-5", provider: "openai", route: OpenAIChat.route })
      yield* admit(session, "First")

      yield* TestLLM.push(TestLLM.text("Done", "text-provider-prompt"))
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
      currentModel = LanguageModel.make({ id: "gpt-5", provider: "openai", route: OpenAIChat.route })
      const agent = yield* Agent.Service
      yield* agent.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.system = ""
          agent.mode = "primary"
        }),
      )
      yield* admit(session, "First")

      yield* TestLLM.push(TestLLM.text("Done", "text-empty-agent-system"))
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
      const agent = yield* Agent.Service
      yield* agent.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.system = "Build agent instructions"
          agent.mode = "primary"
        }),
      )
      yield* admit(session, "First")

      yield* TestLLM.push(TestLLM.text("Done", "text-build"))
      yield* session.resume(sessionID)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual(["Build agent instructions", "Initial context"])
    }),
  )

  it.effect("uses the configured default agent system for omitted-agent sessions", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agent = yield* Agent.Service
      yield* agent.transform((editor) => {
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.system = "Build agent instructions"
          agent.mode = "primary"
        })
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.system = "Reviewer instructions"
          agent.mode = "primary"
        })
        editor.default(Agent.ID.make("reviewer"))
      })
      yield* admit(session, "First")

      yield* TestLLM.push(TestLLM.text("Done", "text-reviewer"))
      yield* session.resume(sessionID)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual(["Reviewer instructions", "Initial context"])
      expect((yield* session.messages({ sessionID }))[0]).toMatchObject({ type: "assistant", agent: "reviewer" })
    }),
  )

  it.effect("uses only the agent prompt and initial instructions as system parts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agent = yield* Agent.Service
      yield* agent.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.system = "Build agent instructions"
          agent.mode = "primary"
        }),
      )
      yield* admit(session, "First")

      yield* TestLLM.push(TestLLM.text("Done", "text-no-system"))
      yield* session.resume(sessionID)

      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual(["Build agent instructions", "Initial context"])
    }),
  )

  it.effect("uses an explicitly selected non-build agent system", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      const agent = yield* Agent.Service
      yield* agent.transform((editor) =>
        editor.update(Agent.ID.make("reviewer"), (agent) => {
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

      yield* TestLLM.push(TestLLM.text("Done", "text-selected"))
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
      const session = yield* Session.Service
      yield* session.prompt({ sessionID, text: "Inspect files", resume: false })

      requests.length = 0
      yield* TestLLM.push([])
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
      const session = yield* Session.Service
      yield* session.prompt({ sessionID, text: "Wait for plugins", resume: false })

      requests.length = 0
      yield* TestLLM.push([])
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
      const bus = yield* Bus.Service
      const agents = yield* Agent.Service
      yield* agents.transform((draft) =>
        draft.update(Agent.ID.make("reviewer"), (agent) => {
          agent.mode = "primary"
        }),
      )
      skillBaselines.set(Agent.ID.make("build"), "Build skills")
      yield* runPrompt(session, "First")
      skillBaselines.set(Agent.ID.make("reviewer"), "Reviewer skills")
      yield* bus.publish(SessionEvent.AgentSelected, {
        sessionID,
        agent: Agent.ID.make("reviewer"),
      })
      yield* runPrompt(session, "Second")

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context\n\nBuild skills"],
        [defaultSystem, "Initial context\n\nBuild skills"],
      ])
      expect(systemTexts(requests[1])).toContainEqual(expect.stringContaining("Reviewer skills"))
    }),
  )

  it.effect("keeps the sampled agent when selection changes during observation", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      skillBaselines.set(Agent.ID.make("build"), "Build skills")
      skillBaselines.set(Agent.ID.make("reviewer"), "Reviewer skills")
      let switched = false
      systemLoadHook = Effect.suspend(() => {
        if (switched) return Effect.void
        switched = true
        return bus
          .publish(SessionEvent.AgentSelected, {
            sessionID,
            agent: Agent.ID.make("reviewer"),
          })
          .pipe(Effect.asVoid)
      })
      yield* runPrompt(session, "First")

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context\n\nBuild skills"],
      ])
    }),
  )

  it.effect("keeps the sampled model when selection changes during model resolution", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      let switched = false
      modelResolveHook = Effect.suspend(() => {
        if (switched) return Effect.void
        switched = true
        return bus
          .publish(SessionEvent.ModelSelected, {
            sessionID,
            model: { id: ID.make("replacement"), providerID: Provider.ID.make("fake") },
          })
          .pipe(Effect.asVoid)
      })
      yield* runPrompt(session, "First")
      expect(requests.map((request) => request.model)).toEqual([model])
      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
      ])
    }),
  )

  it.effect("admits removed context as a chronological System message", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* runPrompt(session, "First")
      systemRemoved = true
      yield* runPrompt(session, "Second")

      expect(messageRoles(requests[1])).toEqual(["user", "system", "user"])
      expect(requests[1]?.messages.at(1)?.content).toEqual([
        { type: "text", text: "System context source removed: test/context" },
      ])
      expect(yield* session.messages({ sessionID })).toHaveLength(3)
    }),
  )

  it.effect("renders API context entries through add, change, and removal", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const contextEntries = yield* InstructionEntry.Service
      yield* contextEntries.put({ sessionID, key: "deploy-target", value: "production" })
      yield* runPrompt(session, "First")

      // String values render verbatim inside the initial tagged block.
      expect(requests[0]?.system.map((part) => part.text)).toEqual([
        defaultSystem,
        ["Initial context", "", '<context key="deploy-target">', "production", "</context>"].join("\n"),
      ])

      // Non-string JSON pretty-prints; the change narrates as a System update.
      yield* contextEntries.put({ sessionID, key: "deploy-target", value: { region: "us-east-1" } })
      yield* runPrompt(session, "Second")

      expect(messageRoles(requests[1])).toEqual(["user", "system", "user"])
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
      yield* runPrompt(session, "Third")

      expect(messageRoles(requests[2])).toEqual(["user", "system", "user", "system", "user"])
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
      yield* runPrompt(session, "First")

      yield* entries.put({ sessionID, key: "nullable", value: null })
      yield* runPrompt(session, "Second")

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
      const bus = yield* Bus.Service
      yield* runPrompt(session, "First")
      systemBaseline = "Changed context"
      yield* runPrompt(session, "Second")
      yield* bus.publish(SessionEvent.ModelSelected, {
        sessionID,
        model: { id: ID.make("replacement"), providerID: Provider.ID.make("fake") },
      })
      systemBaseline = "Replacement context"
      yield* runPrompt(session, "Third")

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
      ])
      expect(messageRoles(requests[1])).toEqual(["user", "system", "user"])
      expect(requests[2]?.messages.filter((message) => message.role === "system")).toHaveLength(2)
      expect((yield* session.context(sessionID)).map((message) => message.type)).toEqual([
        "user",
        "system",
        "user",
        "model-switched",
        "system",
        "user",
      ])
      yield* replaySessionProjection(sessionID)
      expect(yield* session.messages({ sessionID })).toHaveLength(6)
      yield* runPrompt(session, "Fourth")
    }),
  )

  it.effect("preserves instruction values while a source is temporarily unavailable", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      yield* runPrompt(session, "First")
      yield* bus.publish(SessionEvent.ModelSelected, {
        sessionID,
        model: { id: ID.make("replacement"), providerID: Provider.ID.make("fake") },
      })
      systemUnavailable = true
      yield* runPrompt(session, "Second")
      systemUnavailable = false
      systemBaseline = "Replacement context"
      yield* runPrompt(session, "Third")

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
      const bus = yield* Bus.Service
      yield* runPrompt(session, "First")
      yield* bus.publish(SessionEvent.Compaction.Started, {
        sessionID,
        reason: "manual",
        recent: "",
      })
      yield* bus.publish(SessionEvent.Compaction.Ended, {
        sessionID,
        reason: "manual",
        text: "summary",
        recent: "",
      })
      systemBaseline = "Replacement context"
      yield* runPrompt(session, "Second")

      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
      ])
      expect(messageRoles(requests[1])).toEqual(["user", "system", "user"])
      expect(requests[1]?.messages.at(1)?.content).toEqual([{ type: "text", text: "Replacement context" }])
      yield* replaySessionProjection(sessionID)
      yield* runPrompt(session, "Third")
    }),
  )

  it.effect("runs steers before queued compaction and later queued input", () =>
    Effect.gen(function* () {
      const session = yield* setup
      currentModel = recoveryModel
      const stream = yield* TestLLM.gate
      yield* TestLLM.push(
        TestLLM.tool("call-active", "echo", { text: "active" }),
        TestLLM.text("Steer complete", "text-steer"),
        [LLMEvent.textDelta({ id: "summary", text: "durable summary" })],
        TestLLM.text("Queue complete", "text-queue"),
      )
      yield* admit(session, "Active work")
      const active = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started

      const first = yield* session.compact({ sessionID, delivery: "queue" })
      expect(yield* SessionInbox.find((yield* Database.Service).db, first.id)).toMatchObject({
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
      expect(yield* SessionInbox.has((yield* Database.Service).db, sessionID, "steer")).toBe(true)

      yield* stream.release
      yield* Fiber.join(active)

      expect(requests).toHaveLength(4)
      expect(userTexts(requests[1])).toContain("Steer after compaction")
      expect(userTexts(requests[1])).toContain("Completion after compaction")
      expect(userTexts(requests[2])[0]).toContain("Create a new anchored summary")
      expect(userTexts(requests[3])).toContain("Queue after compaction")
      expect(yield* SessionInbox.find((yield* Database.Service).db, first.id)).toBeUndefined()
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
      const stream = yield* TestLLM.gate
      yield* TestLLM.push(
        TestLLM.text("Active complete", "text-active-failure"),
        [],
        TestLLM.text("Continued", "text-after-failure"),
      )
      yield* admit(session, "Active work")
      const active = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started

      const compaction = yield* session.compact({ sessionID })
      yield* session.prompt({
        sessionID,
        text: "Continue after failure",
        delivery: "queue",
        resume: false,
      })
      yield* stream.release
      yield* Fiber.join(active)

      expect(requests).toHaveLength(3)
      expect(userTexts(requests[2])).toContain("Continue after failure")
      expect(yield* SessionInbox.find((yield* Database.Service).db, compaction.id)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
      })
      expect(
        (yield* recordedEventTypes(sessionID)).filter(
          (type) => type === Bus.versionedType(SessionEvent.Compaction.Failed.type, 1),
        ),
      ).toHaveLength(1)
    }),
  )

  it.effect("explains when manual compaction has no history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const compaction = yield* session.compact({ sessionID })
      modelResolveHook = Effect.die("model resolution should not run")

      yield* session.resume(sessionID)

      expect(yield* SessionInbox.find((yield* Database.Service).db, compaction.id)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
        reason: "manual",
        error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
      })
      expect(
        (yield* recordedEventTypes(sessionID)).filter(
          (type) => type === Bus.versionedType(SessionEvent.Compaction.Failed.type, 1),
        ),
      ).toHaveLength(1)
    }),
  )

  it.effect("delivers steered manual compaction when the model has no context limit", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(TestLLM.text("Earlier answer", "text-manual-unknown-history"))
      yield* runPrompt(session, "Earlier question")

      requests.length = 0
      yield* TestLLM.push(TestLLM.text("Manual summary", "text-manual-unknown-summary"))
      const compaction = yield* session.compact({ sessionID, delivery: "steer" })
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

  it.effect("runs manual compaction at the next step boundary before queued prompts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      currentModel = recoveryModel
      const stream = yield* TestLLM.gate
      yield* TestLLM.push(
        TestLLM.text("Active complete", "text-active-steer-compact"),
        [LLMEvent.textDelta({ id: "summary", text: "durable summary" })],
        TestLLM.text("Queue complete", "text-queue-after-compact"),
      )
      yield* admit(session, "Active work")
      const active = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started

      const compaction = yield* session.compact({ sessionID })
      yield* session.prompt({ sessionID, text: "Queued prompt", delivery: "queue", resume: false })
      yield* stream.release
      yield* Fiber.join(active)

      // Steer-delivered compaction runs at the boundary after the active step, ahead of
      // the queued prompt, and consuming it does not trigger an input-free model call.
      expect(requests).toHaveLength(3)
      expect(userTexts(requests[1])[0]).toContain("Create a new anchored summary")
      expect(userTexts(requests[2])).toContain("Queued prompt")
      expect(yield* SessionInbox.find((yield* Database.Service).db, compaction.id)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "completed",
        summary: "durable summary",
      })
    }),
  )

  it.effect("runs manual compaction before the continuation of an active tool turn", () =>
    Effect.gen(function* () {
      const session = yield* setup
      currentModel = recoveryModel
      const stream = yield* TestLLM.gate
      yield* TestLLM.push(
        TestLLM.tool("call-active", "echo", { text: "active" }),
        [LLMEvent.textDelta({ id: "summary", text: "durable summary" })],
        TestLLM.text("Continued", "text-continued-after-compact"),
      )
      yield* admit(session, "Active work")
      const active = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started

      const compaction = yield* session.compact({ sessionID })
      yield* stream.release
      yield* Fiber.join(active)

      // The compaction summary is requested before the tool turn's continuation step.
      expect(requests).toHaveLength(3)
      expect(userTexts(requests[1])[0]).toContain("Create a new anchored summary")
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "completed",
        summary: "durable summary",
      })
    }),
  )

  it.effect("preserves provider errors from manual compaction", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(TestLLM.text("Earlier answer", "text-manual-provider-history"))
      yield* runPrompt(session, "Earlier question")

      yield* TestLLM.push([LLMEvent.providerError({ message: "summary unavailable" })])
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
      yield* TestLLM.push(TestLLM.text("Earlier answer", "text-manual-failure-history"))
      yield* runPrompt(session, "Earlier question")

      yield* TestLLM.push(Stream.fail(providerUnavailable()))
      const compaction = yield* session.compact({ sessionID })
      yield* session.resume(sessionID)

      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
        error: { type: "provider.transport", message: "Provider unavailable" },
      })
    }),
  )

  it.effect("records cancelled manual compaction without surfacing an internal failure", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(TestLLM.text("Earlier answer", "text-manual-interrupt-history"))
      yield* runPrompt(session, "Earlier question")

      const streamed = yield* Deferred.make<void>()
      const partial = fragmentFixture("text", "text-manual-interrupt-summary", ["Partial summary"])
      yield* TestLLM.push(
        Stream.concat(
          Stream.fromIterable(partial.partialEvents),
          Stream.fromEffect(Deferred.succeed(streamed, undefined)).pipe(Stream.flatMap(() => Stream.never)),
        ),
      )
      const compaction = yield* session.compact({ sessionID })
      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamed)
      yield* session.interrupt(sessionID)

      yield* Fiber.await(run)
      expect(yield* SessionInbox.find((yield* Database.Service).db, compaction.id)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
        reason: "manual",
        error: { type: "aborted", message: "Compaction cancelled" },
      })
    }),
  )

  it.effect("settles an admitted manual compaction when pre-start resolution throws", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(TestLLM.text("Earlier answer", "text-manual-resolution-history"))
      yield* runPrompt(session, "Earlier question")

      const compaction = yield* session.compact({ sessionID })
      modelResolveHook = Effect.die("model resolution failed")

      expect(yield* Effect.exit(session.resume(sessionID))).toMatchObject({ _tag: "Failure" })

      expect(yield* SessionInbox.find((yield* Database.Service).db, compaction.id)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
        reason: "manual",
      })
      expect(
        (yield* recordedEventTypes(sessionID)).filter(
          (type) => type === Bus.versionedType(SessionEvent.Compaction.Failed.type, 1),
        ),
      ).toHaveLength(1)
    }),
  )

  it.effect("automatically compacts into a completed summary and retained recent turn", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(TestLLM.textWithUsage("Earlier answer", "text-first", 3_950))
      yield* runPrompt(session, "Earlier question ".repeat(180))

      currentModel = compactModel
      requests.length = 0
      yield* TestLLM.push(
        TestLLM.text("## Objective\n- Preserve the task", "text-summary"),
        TestLLM.textWithUsage("Continued", "text-final", 3_950),
      )
      yield* runPrompt(session, "Recent exact request ".repeat(180))

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
      yield* TestLLM.push(
        TestLLM.text("## Objective\n- Preserve the updated task", "text-summary-2"),
        TestLLM.text("Continued again", "text-final-2"),
      )
      yield* runPrompt(session, "Newest exact request ".repeat(180))

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
      yield* TestLLM.push(TestLLM.textWithUsage("Earlier answer", "text-full-output-first", 9_500))
      yield* runPrompt(session, "Earlier question")

      requests.length = 0
      yield* TestLLM.push(TestLLM.text("Continued", "text-full-output-final"))
      yield* runPrompt(session, "Continue")

      expect(requests).toHaveLength(1)
      expect(userTexts(requests[0])).toContain("Continue")
      expect(yield* session.context(sessionID)).not.toContainEqual(expect.objectContaining({ type: "compaction" }))
    }),
  )

  it.effect("stops after required automatic compaction fails", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(TestLLM.textWithUsage("Earlier answer", "text-before-failed-compaction", 3_950))
      yield* runPrompt(session, "Earlier question ".repeat(180))

      currentModel = compactModel
      requests.length = 0
      yield* TestLLM.push(
        [LLMEvent.providerError({ message: "Unsupported parameter: max_output_tokens" })],
        TestLLM.text("Must not run", "text-after-failed-compaction"),
      )
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
      yield* TestLLM.push(
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }),
        ],
        TestLLM.text("## Objective\n- Recover overflow", "text-summary"),
        TestLLM.text("Recovered", "text-final"),
      )
      yield* runPrompt(session, "Continue")

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
      yield* TestLLM.push(
        [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
        TestLLM.text("## Objective\n- Recover unknown limit", "text-summary-unknown-limit"),
        TestLLM.text("Recovered", "text-final-unknown-limit"),
      )
      yield* runPrompt(session, "Continue")

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
      yield* TestLLM.push(
        [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
        TestLLM.text("## Objective\n- Recover undersized limit", "text-summary-undersized-limit"),
        TestLLM.text("Recovered", "text-final-undersized-limit"),
      )
      yield* runPrompt(session, "Continue")

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
      yield* TestLLM.push(overflow(), TestLLM.text("## Objective\n- Recover once", "text-summary"), overflow())
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
      yield* TestLLM.push(
        Stream.fail(
          new AIError({
            module: "test",
            method: "stream",
            reason: new InvalidRequestReason({
              message: "prompt too long",
              classification: "context-overflow",
            }),
          }),
        ),
      )
      yield* TestLLM.push(
        TestLLM.text("## Objective\n- Recover raw overflow", "text-summary"),
        TestLLM.text("Recovered", "text-final"),
      )
      yield* runPrompt(session, "Continue")

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
      yield* TestLLM.push(
        [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
        [LLMEvent.providerError({ message: "summary unavailable" })],
      )
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
      yield* TestLLM.push(
        [LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })],
        TestLLM.text("## Objective\n- Interrupted", "text-summary"),
      )
      const first = yield* TestLLM.gate
      yield* admit(session, "Continue")
      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* first.started

      const summary = yield* TestLLM.gate
      yield* first.release
      yield* summary.started

      yield* session.interrupt(sessionID)
      const exit = yield* Fiber.await(run)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
      expect(yield* session.context(sessionID)).toContainEqual(
        expect.objectContaining({
          type: "compaction",
          status: "failed",
          reason: "auto",
          error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
        }),
      )
    }),
  )

  it.effect("uses epoch values after compaction while a source is unavailable", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      yield* runPrompt(session, "First")
      systemBaseline = "Changed context"
      yield* runPrompt(session, "Second")
      yield* bus.publish(SessionEvent.Compaction.Started, {
        sessionID,
        reason: "manual",
        recent: "",
      })
      yield* bus.publish(SessionEvent.Compaction.Ended, {
        sessionID,
        reason: "manual",
        text: "summary",
        recent: "",
      })
      systemUnavailable = true
      yield* runPrompt(session, "Third")

      // Compaction already moved current values into the new epoch before the unavailable read.
      expect(requests.at(-1)?.system.map((part) => part.text)).toEqual([defaultSystem, "Changed context"])
      expect(systemTexts(requests.at(-1)!)).not.toContain("Changed context")
    }),
  )

  it.effect("projects reasoning and tool events without executing or continuing tools", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Use tools")

      yield* TestLLM.push(
        TestLLM.complete(
          {
            reason: { normalized: "tool-calls" },
            usage: {
              inputTokens: 10,
              nonCachedInputTokens: 8,
              outputTokens: 4,
              reasoningTokens: 1,
              cacheReadInputTokens: 2,
            },
          },
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
        ),
      )

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.tools.map((tool) => tool.name)).toEqual(["defect", "echo", "storefail"])
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

      yield* TestLLM.push(TestLLM.tool("call-echo", "echo", { text: "hello" }), TestLLM.text("Done", "text-final"))

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(messageRoles(requests[1])).toEqual(["user", "assistant", "tool"])
      expect(authorizations).toMatchObject([{ sessionID, id: "call-echo" }])
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
                content: [{ type: "text", text: "hello" }],
              },
            },
          ],
        },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Done" }] },
      ])
      const assistant = requireAssistant(context)
      expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.success.2",
        "session.step.ended.1",
      ])
    }),
  )

  it.effect("reloads a model switch before a tool-driven continuation step", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      yield* admit(session, "Echo this")

      yield* TestLLM.push(TestLLM.tool("call-echo", "echo", { text: "hello" }), TestLLM.stop())
      const tools = yield* blockTools()
      const run = yield* Effect.forkChild(session.resume(sessionID))
      yield* tools.started
      yield* bus.publish(SessionEvent.ModelSelected, {
        sessionID,
        model: { id: ID.make("replacement"), providerID: Provider.ID.make("fake") },
      })
      systemBaseline = "Replacement context"
      yield* tools.release
      yield* Fiber.join(run)

      expect(requests.map((request) => request.model)).toEqual([model, replacementModel])
      expect(requests.map((request) => request.system.map((part) => part.text))).toEqual([
        [defaultSystem, "Initial context"],
        [defaultSystem, "Initial context"],
      ])
      expect(systemTexts(requests[1])).toContain("Replacement context")
    }),
  )

  it.effect("restores durable reasoning provider metadata in the next request", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Think first")

      yield* TestLLM.push(
        TestLLM.stop(
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
        ),
      )
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
      yield* TestLLM.push([])
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

  it.effect("restores durable text provider metadata in the next request", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Check first")

      yield* TestLLM.push(
        TestLLM.stop(
          LLMEvent.textStart({
            id: "commentary",
            providerMetadata: { openai: { itemId: "msg_commentary", phase: "commentary" } },
          }),
          LLMEvent.textDelta({ id: "commentary", text: "Checking." }),
          LLMEvent.textEnd({
            id: "commentary",
            providerMetadata: {
              openai: { itemId: "msg_commentary", phase: "commentary" },
              anthropic: { ignored: true },
            },
          }),
        ),
      )
      yield* session.resume(sessionID)
      yield* replaySessionProjection(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Check first" },
        {
          type: "assistant",
          content: [{ type: "text", text: "Checking.", state: { itemId: "msg_commentary", phase: "commentary" } }],
        },
      ])

      yield* admit(session, "Continue")
      yield* TestLLM.push([])
      yield* session.resume(sessionID)

      expect(requests[1]?.messages[1]?.content).toEqual([
        {
          type: "text",
          text: "Checking.",
          providerMetadata: { openai: { itemId: "msg_commentary", phase: "commentary" } },
        },
      ])
    }),
  )

  it.effect("replays durable provider-executed tool results inline in the next request", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Search first")

      yield* TestLLM.push(
        TestLLM.stop(
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
        ),
      )
      yield* session.resume(sessionID)
      yield* replaySessionProjection(sessionID)

      yield* admit(session, "Continue")
      yield* TestLLM.push([])
      yield* session.resume(sessionID)

      expect(messageRoles(requests[1])).toEqual(["user", "assistant", "user"])
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
          // The generic replay result derives from canonical stored content.
          result: { type: "text", value: '[{"title":"Effect"}]' },
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

      const tools = yield* blockTools(5)
      const providerGate = yield* Deferred.make<void>()
      const initial = Stream.fromIterable([
        LLMEvent.stepStart({ index: 0 }),
        ...Array.from({ length: 5 }, (_, index) =>
          LLMEvent.toolCall({ id: `call-echo-${index}`, name: "echo", input: { text: `${index}` } }),
        ),
      ])
      const final = Stream.fromIterable([
        LLMEvent.stepFinish({ index: 0, reason: { normalized: "tool-calls" } }),
        LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
      ])
      yield* TestLLM.push(
        Stream.concat(initial, Stream.fromEffect(Deferred.await(providerGate)).pipe(Stream.flatMap(() => final))),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* tools.started

      expect(executions).toHaveLength(5)
      expect(yield* tools.maxActive).toBe(5)
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

      yield* tools.release
      yield* Fiber.join(run)

      expect(executions).toHaveLength(5)
      expect(yield* tools.maxActive).toBe(5)
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("settles repeated provider-local tool call IDs against their owning assistant messages", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Echo twice")

      yield* TestLLM.push(
        TestLLM.tool("tool_0", "echo", { text: "first" }),
        TestLLM.tool("tool_0", "echo", { text: "second" }),
        [],
      )

      yield* session.resume(sessionID)

      const expected = [
        { type: "user", text: "Echo twice" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "tool_0",
              state: { status: "completed", content: [{ type: "text", text: "first" }] },
            },
          ],
        },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "tool_0",
              state: { status: "completed", content: [{ type: "text", text: "second" }] },
            },
          ],
        },
      ]
      expect(executions).toEqual(["first", "second"])
      expect(requests).toHaveLength(3)
      expect(yield* session.context(sessionID)).toMatchObject(expected)

      yield* replaySessionProjection(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject(expected)
    }),
  )

  it.effect("joins concurrent resume calls into one active provider run", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Run once")

      yield* TestLLM.push(TestLLM.text("Once", "text-once"))
      const stream = yield* TestLLM.gate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      const second = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(requests).toHaveLength(1)
      yield* stream.release
      yield* Fiber.join(first)
      yield* Fiber.join(second)

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

      yield* TestLLM.push(TestLLM.stop(), TestLLM.stop())
      const stream = yield* TestLLM.gate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* session.prompt({ sessionID, text: "Change direction" })
      yield* stream.release
      yield* Fiber.join(first)
      yield* Effect.yieldNow

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0])).toEqual(["Start working"])
      expect(userTexts(requests[1])).toEqual(["Start working", "Change direction"])
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

      yield* TestLLM.push(TestLLM.tool("call-echo", "echo", { text: "hello" }), TestLLM.stop(), TestLLM.stop())
      const stream = yield* TestLLM.gate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* session.prompt({
        sessionID,
        text: "Wait until continuation ends",
        delivery: "queue",
      })
      yield* stream.release
      yield* Fiber.join(first)

      expect(requests).toHaveLength(3)
      expect(userTexts(requests[0])).toEqual(["Start working"])
      expect(userTexts(requests[1])).toEqual(["Start working"])
      expect(userTexts(requests[2])).toEqual(["Start working", "Wait until continuation ends"])
    }),
  )

  it.effect("preserves durable queued input for a later wake after interruption", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      yield* admit(session, "Interrupt current work")

      yield* TestLLM.push([], TestLLM.stop())
      const stream = yield* TestLLM.gate

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* session.prompt({
        sessionID,
        text: "Run after interrupt",
        delivery: "queue",
      })
      yield* session.interrupt(sessionID)
      expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
      expect(requests).toHaveLength(1)
      expect(yield* SessionInbox.has(db, sessionID, "queue")).toBe(true)
      const resumed = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* stream.release
      yield* Fiber.join(resumed)

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0])).toEqual(["Interrupt current work"])
      expect(userTexts(requests[1])).toEqual(["Interrupt current work", "Run after interrupt"])
    }),
  )

  it.effect("preserves durable steering input for a later resume after interruption", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      yield* admit(session, "Interrupt current work")

      yield* TestLLM.push([], TestLLM.stop())
      const stream = yield* TestLLM.gate

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* session.prompt({
        sessionID,
        text: "Steer after interrupt",
      })
      yield* session.interrupt(sessionID)
      expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
      expect(requests).toHaveLength(1)
      expect(yield* SessionInbox.has(db, sessionID, "steer")).toBe(true)

      const resumed = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* stream.release
      yield* Fiber.join(resumed)

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0])).toEqual(["Interrupt current work"])
      expect(userTexts(requests[1])).toEqual(["Interrupt current work", "Steer after interrupt"])
    }),
  )

  it.effect("promotes queued inputs one at a time in FIFO order", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start working")

      yield* TestLLM.push(TestLLM.stop(), TestLLM.stop(), TestLLM.stop())
      const stream = yield* TestLLM.gate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* session.prompt({ sessionID, text: "Queue first", delivery: "queue" })
      yield* session.prompt({ sessionID, text: "Queue second", delivery: "queue" })
      yield* stream.release
      yield* Fiber.join(first)

      expect(requests).toHaveLength(3)
      expect(userTexts(requests[0])).toEqual(["Start working"])
      expect(userTexts(requests[1])).toEqual(["Start working", "Queue first"])
      expect(userTexts(requests[2])).toEqual(["Start working", "Queue first", "Queue second"])
    }),
  )

  it.effect("stops a steer-scoped drain before queued input", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      yield* session.prompt({ sessionID, text: "Queue for later", delivery: "queue", resume: false })
      yield* session.prompt({ sessionID, text: "Steer now", resume: false })
      yield* TestLLM.push(TestLLM.stop())

      const runner = yield* SessionRunner.Service
      yield* runner.drain({ sessionID, force: false, promotable: "steer" })

      expect(requests).toHaveLength(1)
      expect(userTexts(requests[0])).toEqual(["Steer now"])
      expect(yield* SessionInbox.has(db, sessionID, "steer")).toBe(false)
      expect(yield* SessionInbox.has(db, sessionID, "queue")).toBe(true)
    }),
  )

  it.effect("a steer-scoped drain runs a queued manual compaction next in line", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      const bus = yield* Bus.Service
      // Admit without waking so the steer-scoped drain below is the first consumer.
      const compaction = yield* SessionInbox.admitCompaction(db, bus, {
        id: SessionMessage.ID.create(),
        sessionID,
        delivery: "queue",
      })

      const runner = yield* SessionRunner.Service
      yield* runner.drain({ sessionID, force: false, promotable: "steer" })

      // Control work is scope-independent between turns: the barrier is consumed
      // even though the drain never promotes queued input.
      expect(yield* SessionInbox.find(db, compaction.id)).toBeUndefined()
      expect((yield* session.messages({ sessionID })).find((message) => message.id === compaction.id)).toMatchObject({
        type: "compaction",
        status: "failed",
        error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
      })
    }),
  )

  it.effect("a steer-scoped drain leaves a compaction parked behind a queued prompt", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const { db } = yield* Database.Service
      const bus = yield* Bus.Service
      yield* session.prompt({ sessionID, text: "Queue for later", delivery: "queue", resume: false })
      const compaction = yield* SessionInbox.admitCompaction(db, bus, {
        id: SessionMessage.ID.create(),
        sessionID,
        delivery: "queue",
      })

      const runner = yield* SessionRunner.Service
      yield* runner.drain({ sessionID, force: false, promotable: "steer" })

      // Enqueue order holds: the queued prompt is next in line, so nothing runs.
      expect(requests).toHaveLength(0)
      expect(yield* SessionInbox.has(db, sessionID, "queue")).toBe(true)
      expect(yield* SessionInbox.find(db, compaction.id)).toMatchObject({ id: compaction.id })
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

      yield* TestLLM.push(TestLLM.stop(), TestLLM.stop())

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[0])).toEqual(["Start steering"])
      expect(userTexts(requests[1])).toEqual(["Start steering", "Queue for later"])
    }),
  )

  it.effect("promotes steers before the next queued input", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start working")

      yield* TestLLM.push(TestLLM.stop(), TestLLM.stop(), TestLLM.stop(), TestLLM.stop())
      const firstStream = yield* TestLLM.gate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* firstStream.started
      yield* session.prompt({ sessionID, text: "Queue first", delivery: "queue" })
      yield* session.prompt({ sessionID, text: "Queue second", delivery: "queue" })
      const secondStream = yield* TestLLM.gate
      yield* firstStream.release
      yield* secondStream.started
      yield* session.prompt({ sessionID, text: "Steer before next queued input" })
      yield* session.prompt({
        sessionID,
        text: "Also steer before next queued input",
      })
      yield* session.synthetic({ sessionID, text: "Background completion before next queued input" })
      yield* secondStream.release
      yield* Fiber.join(first)

      expect(requests).toHaveLength(4)
      expect(userTexts(requests[0])).toEqual(["Start working"])
      expect(userTexts(requests[1])).toEqual(["Start working", "Queue first"])
      expect(userTexts(requests[2])).toEqual([
        "Start working",
        "Queue first",
        "Steer before next queued input",
        "Also steer before next queued input",
        "Background completion before next queued input",
      ])
      expect(userTexts(requests[3])).toEqual([
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

      yield* TestLLM.push(TestLLM.stop(), TestLLM.stop())
      const stream = yield* TestLLM.gate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* session.prompt({ sessionID, text: "First steer" })
      yield* session.prompt({ sessionID, text: "Second steer" })
      yield* stream.release
      yield* Fiber.join(first)
      yield* Effect.yieldNow

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[1])).toEqual(["Start working", "First steer", "Second steer"])
      yield* (yield* SessionExecution.Service).wake(sessionID)
      yield* Effect.yieldNow
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("runs steering input accepted while the active step fails", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Start working")

      const failure = invalidRequest()
      yield* TestLLM.push(Stream.fail(failure))
      const stream = yield* TestLLM.gate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* session.prompt({ sessionID, text: "Recover with this" })
      yield* stream.release
      expect(yield* Fiber.join(first).pipe(Effect.flip)).toBe(failure)

      yield* TestLLM.push([])
      yield* session.wait(sessionID)

      expect(requests).toHaveLength(2)
      expect(userTexts(requests[1])).toEqual(["Start working", "Recover with this"])
    }),
  )

  it.effect("durably fails local tools left running by a prior process before continuing", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      yield* admit(session, "Recover interrupted tool")
      yield* SessionInbox.promote((yield* Database.Service).db, bus, sessionID, "steer")
      const assistantMessageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: Agent.ID.make("build"),
        model: { id: ID.make("fake-model"), providerID: Provider.ID.make("fake") },
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID,
        id: "call-interrupted",
        name: "echo",
      })
      yield* bus.publish(SessionEvent.Tool.Input.Ended, {
        sessionID,
        assistantMessageID,
        id: "call-interrupted",
        text: '{"text":"stale"}',
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID,
        id: "call-interrupted",
        input: { text: "stale" },
        executed: false,
      })
      requests.length = 0
      yield* TestLLM.push([])
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(messageRoles(requests[0])).toEqual(["user", "assistant", "tool"])
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
      const bus = yield* Bus.Service
      yield* admit(session, "Recover interrupted hosted tool")
      yield* SessionInbox.promote((yield* Database.Service).db, bus, sessionID, "steer")
      const assistantMessageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: Agent.ID.make("build"),
        model: { id: ID.make("fake-model"), providerID: Provider.ID.make("fake") },
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID,
        id: "call-hosted-interrupted",
        name: "web_search",
      })
      yield* bus.publish(SessionEvent.Tool.Input.Ended, {
        sessionID,
        assistantMessageID,
        id: "call-hosted-interrupted",
        text: '{"query":"stale"}',
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID,
        id: "call-hosted-interrupted",
        input: { query: "stale" },
        executed: true,
        state: { itemId: "call-hosted-interrupted" },
      })
      requests.length = 0
      yield* TestLLM.push([])
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(messageRoles(requests[0])).toEqual(["user", "assistant"])
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
      const bus = yield* Bus.Service
      yield* admit(session, "Recover interrupted tool input")
      yield* SessionInbox.promote((yield* Database.Service).db, bus, sessionID, "steer")
      const assistantMessageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: Agent.ID.make("build"),
        model: { id: ID.make("fake-model"), providerID: Provider.ID.make("fake") },
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID,
        id: "call-pending-interrupted",
        name: "echo",
      })
      requests.length = 0
      yield* TestLLM.push([])
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(messageRoles(requests[0])).toEqual(["user", "assistant", "tool"])
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

      const stream = yield* TestLLM.gate
      yield* (yield* SessionExecution.Service).wake(sessionID)
      yield* stream.started
      yield* stream.release

      expect(requests).toHaveLength(1)
      expect(userTexts(requests[0])).toEqual(["Wait in queue"])
    }),
  )

  it.effect("retries inbox input after prompt projection rolls back", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      const defect = new Error("fail after prompt promotion")
      let fail = true
      yield* bus.project(SessionEvent.InboxDelivered, () => (fail ? Effect.die(defect) : Effect.void))
      yield* admit(session, "Recover promoted input")

      expect(yield* session.resume(sessionID).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
      fail = false
      requests.length = 0
      yield* TestLLM.push(TestLLM.stop())

      const stream = yield* TestLLM.gate
      yield* (yield* SessionExecution.Service).wake(sessionID)
      yield* stream.started
      yield* stream.release

      expect(userTexts(requests[0])).toEqual(["Recover promoted input"])
    }),
  )

  it.effect("does not strand a committed promotion when a post-commit listener defects", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const bus = yield* Bus.Service
      yield* bus.listen((event) =>
        event.type === SessionEvent.InboxDelivered.type
          ? Effect.die("fail after prompt promotion commits")
          : Effect.void,
      )
      yield* runPrompt(session, "Run committed promotion")

      expect(requests).toHaveLength(1)
      expect(userTexts(requests[0])).toEqual(["Run committed promotion"])
    }),
  )

  it.effect("adds session correlation headers to model requests", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* runPrompt(session, "Run correlated request")

      expect(requests[0]?.http?.headers).toEqual({
        "x-session-affinity": sessionID,
        "X-Session-Id": sessionID,
        "User-Agent": App.useragent(App.make()),
        "x-opencode-project": Project.ID.global,
        "x-opencode-session": sessionID,
        "x-opencode-client": "opencode",
      })
    }),
  )

  it.effect("adds the parent session header to child model requests", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const parentID = Session.ID.make("ses_runner_parent")
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: parentID })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* runPrompt(session, "Run child request")

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

      const stream = yield* TestLLM.gate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      const second = yield* session.resume(otherSessionID).pipe(Effect.forkChild)
      yield* stream.started

      expect(requests).toHaveLength(2)
      expect(requests.map((request) => request.promptCacheKey)).toEqual([sessionID, otherSessionID])
      yield* stream.release
      yield* Fiber.join(first)
      yield* Fiber.join(second)
    }),
  )

  it.effect("bounds 64-character session prompt cache keys", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const longSessionID = Session.ID.make(`ses_${"a".repeat(64)}`)
      const otherLongSessionID = Session.ID.make(`ses_${"b".repeat(64)}`)
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

      const keys = requests.map((request) => request.promptCacheKey)
      expect(keys).toEqual([longSessionID.slice(4), otherLongSessionID.slice(4)])
      expect(keys.every((key) => typeof key === "string" && key.length === 64)).toBe(true)
      expect(keys[0]).not.toBe(keys[1])
    }),
  )

  it.effect("fans out one failed run and allows a later retry", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Retry after failure")

      yield* TestLLM.push(Stream.fail(invalidRequest()))
      const stream = yield* TestLLM.gate

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      const second = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(requests).toHaveLength(1)
      yield* stream.release
      const [firstExit, secondExit] = yield* Effect.all([Fiber.await(first), Fiber.await(second)])
      expect(secondExit).toEqual(firstExit)

      yield* TestLLM.push([])
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("durably settles local tool failures before continuing", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Call missing")

      yield* TestLLM.push(TestLLM.tool("call-missing", "missing", {}), TestLLM.text("Recovered", "text-after-error"))
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
                error: { type: "tool.execution", message: "Unknown tool: missing" },
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

      yield* TestLLM.push(TestLLM.tool("call-defect", "defect", {}), TestLLM.text("Recovered", "text-after-defect"))

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(messageRoles(requests[1])).toEqual(["user", "assistant", "tool"])
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
      expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.2",
        "session.step.ended.1",
      ])
    }),
  )

  it.effect("returns tool-wrapped policy blocks to the model and continues", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* Tool.Service
      yield* transformTools(
        registry,
        {
          blocked: {
            name: "blocked",
            description: "Fail because policy blocked execution",
            input: Schema.Struct({}),
            output: Schema.Struct({}),
            execute: () =>
              Effect.fail(new Permission.BlockedError({ rules: [], permission: "blocked", resources: ["*"] })).pipe(
                Effect.mapError(() => new Tool.Error({ message: "Permission blocked" })),
              ),
          },
        },
        { codemode: false },
      )
      yield* admit(session, "Call blocked")

      yield* TestLLM.push(TestLLM.tool("call-blocked", "blocked", {}), TestLLM.stop())

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
      const registry = yield* Tool.Service
      yield* transformTools(
        registry,
        {
          declined: {
            name: "declined",
            description: "Fail because the user declined approval",
            input: Schema.Struct({}),
            output: Schema.Struct({}),
            execute: () => Effect.die(new Permission.DeclinedError()),
          },
        },
        { codemode: false },
      )
      yield* admit(session, "Call declined")

      yield* TestLLM.push(TestLLM.tool("call-declined", "declined", {}))

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
              state: { status: "error", error: { type: "aborted", message: "The user declined this tool call" } },
            },
          ],
        },
      ])
    }),
  )

  it.effect("returns permission corrections to the model and continues", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* Tool.Service
      yield* transformTools(
        registry,
        {
          corrected: {
            name: "corrected",
            description: "Fail with user correction feedback",
            input: Schema.Struct({}),
            output: Schema.Struct({}),
            execute: () =>
              Effect.fail(new Permission.CorrectedError({ feedback: "Use another tool" })).pipe(
                Effect.mapError(() => new Tool.Error({ message: "Use another tool" })),
              ),
          },
        },
        { codemode: false },
      )
      yield* admit(session, "Call corrected")

      yield* TestLLM.push(TestLLM.tool("call-corrected", "corrected", {}), TestLLM.stop())

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

  it.effect("returns configured permission denials to the model and continues", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const registry = yield* Tool.Service
      yield* transformTools(registry, { permissionfail: permissionFail }, { codemode: false })
      yield* admit(session, "Reject permission")
      yield* TestLLM.push(TestLLM.tool("call-permission", "permissionfail", {}), [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
      ])

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
      const registry = yield* Tool.Service
      yield* transformTools(
        registry,
        {
          question: {
            name: "question",
            description: "Ask the user",
            input: Schema.Struct({}),
            output: Schema.Struct({}),
            execute: () => Effect.die(new QuestionTool.CancelledError()),
          },
        },
        { codemode: false },
      )
      yield* admit(session, "Ask then stop")

      yield* TestLLM.push(TestLLM.tool("call-question", "question", {}), [])

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
              state: { status: "error", error: { type: "aborted", message: "The user dismissed this question" } },
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
      const tools = yield* blockTools()
      yield* TestLLM.push(
        TestLLM.failAfter(
          failure,
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-before-failure", name: "echo", input: { text: "settle" } }),
        ),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* tools.started
      yield* tools.release
      expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)

      const context = yield* session.context(sessionID)
      expect(context).toMatchObject([
        { type: "user", text: "Settle before failing" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-before-failure",
              state: { status: "completed", content: [{ type: "text", text: "settle" }] },
            },
          ],
        },
      ])
      const assistant = requireAssistant(context)
      expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.success.2",
        "session.step.failed.1",
      ])
    }),
  )

  it.effect("durably fails blocked local tools when a step is interrupted", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Interrupt blocked tool")
      const tools = yield* blockTools()
      yield* TestLLM.push(
        TestLLM.hangAfter(
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-before-interrupt", name: "echo", input: { text: "blocked" } }),
        ),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* tools.started
      yield* session.interrupt(sessionID)

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
      expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.2",
        "session.step.failed.1",
      ])

      yield* replaySessionProjection(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Interrupt blocked tool" },
        { type: "assistant", content: [{ type: "tool", id: "call-before-interrupt", state: { status: "error" } }] },
      ])
      requests.length = 0
      yield* TestLLM.push([])
      yield* session.resume(sessionID)
      expect(messageRoles(requests[0])).toEqual(["user", "assistant", "tool"])
    }),
  )

  it.effect("interrupts a blocked step without local tool execution", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Interrupt provider")
      const stream = yield* TestLLM.gate

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* session.interrupt(sessionID)
      const exit = yield* Fiber.await(run)

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
      const tools = yield* blockTools()
      yield* TestLLM.push(TestLLM.tool("call-await-interrupt", "echo", { text: "blocked" }))

      const runner = yield* SessionRunner.Service
      const run = yield* runner.drain({ sessionID, force: true }).pipe(Effect.forkChild)
      yield* tools.started
      yield* Fiber.interrupt(run)

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
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.steps = 2
        }),
      )
      yield* admit(session, "Finish at the limit")

      yield* TestLLM.push(
        TestLLM.tool("call-terminal", "echo", { text: "done" }),
        TestLLM.tool("call-forbidden", "echo", { text: "forbidden" }),
      )

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(requests[0]?.toolChoice).toBeUndefined()
      expect(requests[1]?.toolChoice).toMatchObject({ type: "none" })
      // Protocols with native "none" keep these definitions for prompt caching.
      expect(requests[1]?.tools.map((tool) => tool.name)).toContain("echo")
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
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.steps = 2
        }),
      )
      yield* admit(session, "Start work")

      yield* TestLLM.push(
        TestLLM.tool("call-before-steer", "echo", { text: "before" }),
        TestLLM.tool("call-after-steer", "echo", { text: "after" }),
        TestLLM.stop(),
      )
      const stream = yield* TestLLM.gate

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* stream.started
      yield* session.prompt({ sessionID, text: "Change direction" })
      yield* stream.release
      yield* Fiber.join(run)

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
      yield* TestLLM.push([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.providerError({ message: "Provider unavailable" }),
      ])

      expect((yield* runPrompt(session, "Fail durably").pipe(Effect.flip)).message).toBe("Provider unavailable")

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
      yield* TestLLM.push([LLMEvent.providerError({ message: "Provider unavailable" })])

      expect((yield* runPrompt(session, "Fail before step").pipe(Effect.flip)).message).toBe("Provider unavailable")

      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail before step" },
        { type: "assistant", finish: "error", error: { type: "provider.unknown", message: "Provider unavailable" } },
      ])
    }),
  )

  it.effect("persists raw finish reasons and provider state", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(
        TestLLM.complete(
          {
            reason: { normalized: "stop", raw: "end_turn" },
            providerMetadata: { openai: { responseId: "response-1", serviceTier: "priority" } },
          },
          LLMEvent.textStart({ id: "answer" }),
          LLMEvent.textDelta({ id: "answer", text: "Complete" }),
          LLMEvent.textEnd({ id: "answer" }),
        ),
      )

      yield* runPrompt(session, "Keep provider finish details")

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        {
          type: "assistant",
          finish: "stop",
          rawFinish: "end_turn",
          providerState: { responseId: "response-1", serviceTier: "priority" },
          content: [{ type: "text", text: "Complete" }],
        },
      ])
    }),
  )

  it.effect("projects content-filter finishes as visible terminal failures", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(
        TestLLM.complete(
          {
            reason: { normalized: "content-filter", raw: "SAFETY" },
            providerMetadata: {
              openai: {
                responseId: "response-blocked",
                refusal: { category: "safety", explanation: "Prompt blocked" },
              },
            },
            usage: { nonCachedInputTokens: 8, outputTokens: 3, reasoningTokens: 1 },
          },
          LLMEvent.textStart({ id: "partial" }),
          LLMEvent.textDelta({ id: "partial", text: "Partial" }),
        ),
      )

      expect((yield* runPrompt(session, "Blocked response").pipe(Effect.flip)).message).toBe(
        "Provider blocked the response",
      )
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        {
          type: "assistant",
          finish: "content-filter",
          rawFinish: "SAFETY",
          providerState: {
            responseId: "response-blocked",
            refusal: { category: "safety", explanation: "Prompt blocked" },
          },
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
      const tools = yield* blockTools()
      yield* TestLLM.push(
        TestLLM.complete(
          { reason: { normalized: "content-filter" } },
          LLMEvent.toolCall({ id: "call-before-content-filter", name: "echo", input: { text: "settled" } }),
        ),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* tools.started
      yield* tools.release
      expect((yield* Fiber.join(run).pipe(Effect.flip)).message).toBe("Provider blocked the response")

      const assistant = requireAssistant(yield* session.context(sessionID))
      const bus = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(bus.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.success.2",
        "session.step.failed.1",
      ])
      expect(
        bus.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
      ).toHaveLength(1)
    }),
  )

  it.effect("does not recover context overflow after durable assistant output", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-partial" }),
        LLMEvent.textDelta({ id: "text-partial", text: "Partial" }),
        LLMEvent.textEnd({ id: "text-partial" }),
        LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }),
      ])
      expect((yield* runPrompt(session, "Fail after output").pipe(Effect.flip)).message).toBe("prompt too long")

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
      const failure = invalidRequest()
      yield* TestLLM.push(Stream.fail(failure))

      expect(yield* runPrompt(session, "Fail raw stream durably").pipe(Effect.flip)).toBe(failure)
      yield* replaySessionProjection(sessionID)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail raw stream durably" },
        { type: "assistant", finish: "error", error: { type: "provider.invalid-request", message: "Invalid request" } },
      ])
    }),
  )

  it.effect("bounds jittered exponential backoff for eligible pre-output failures", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Retry transport")
      yield* TestLLM.push(Stream.fail(providerUnavailable()))
      yield* TestLLM.push(TestLLM.text("Recovered", "retry-success"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      yield* TestClock.adjust("1599 millis")
      expect(requests).toHaveLength(1)
      yield* TestClock.adjust("801 millis")
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

  it.effect("immediately rebuilds once after explicit continuation rejection", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(Stream.fail(continuationRejected("retry-full")))
      yield* TestLLM.push(TestLLM.text("Recovered", "continuation-recovery"))

      yield* runPrompt(session, "Recover continuation")

      expect(requests).toHaveLength(2)
      expect(yield* recordedEventTypes(sessionID)).not.toContain("session.retry.scheduled.1")
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Recovered" }] },
      ])
    }),
  )

  it.effect("bounds repeated continuation rejection to one immediate recovery", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const failure = continuationRejected("rotate-and-retry-full")
      yield* TestLLM.push(Stream.fail(failure), Stream.fail(failure))

      expect(yield* runPrompt(session, "Reject continuation twice").pipe(Effect.flip)).toBe(failure)

      expect(requests).toHaveLength(2)
      expect(yield* recordedEventTypes(sessionID)).not.toContain("session.retry.scheduled.1")
    }),
  )

  it.effect("retries an incomplete stream before output", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Retry incomplete stream")
      yield* TestLLM.push(Stream.fail(incompleteStream()))
      yield* TestLLM.push(TestLLM.text("Recovered", "incomplete-stream-success"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)

      expect(requests).toHaveLength(2)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Recovered" }] },
      ])
    }),
  )

  it.effect("retries an unknown finish before output", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Retry unknown finish")
      yield* TestLLM.push([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.stepFinish({ index: 0, reason: { normalized: "unknown" } }),
        LLMEvent.finish({ reason: { normalized: "unknown" } }),
      ])
      yield* TestLLM.push(TestLLM.text("Recovered", "unknown-finish-success"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)

      expect(requests).toHaveLength(2)
      expect(yield* recordedEventTypes(sessionID)).toContain("session.retry.scheduled.1")
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Recovered" }] },
      ])
    }),
  )

  it.effect("uses a larger provider retry-after delay", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Retry rate limit")
      yield* TestLLM.push(Stream.fail(rateLimited(5_000)))
      yield* TestLLM.push(TestLLM.text("Recovered", "retry-after-success"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      yield* TestClock.adjust("4999 millis")
      expect(requests).toHaveLength(1)
      yield* TestClock.adjust("1 millis")
      yield* Fiber.join(run)
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("continues an incomplete stream after observable text", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const failure = incompleteStream()
      yield* admit(session, "Continue partial output")
      yield* TestLLM.push(
        TestLLM.failAfter(
          failure,
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "partial-rate-limit" }),
          LLMEvent.textDelta({ id: "partial-rate-limit", text: "Partial" }),
        ),
      )
      yield* TestLLM.push(TestLLM.text(" continuation", "continued-text"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)

      expect(requests).toHaveLength(2)
      expect(requests[1]?.messages.at(-2)).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "Partial" }],
      })
      expect(requests[1]?.messages.at(-1)).toMatchObject({
        role: "user",
        content: [
          {
            type: "text",
            text: INCOMPLETE_STREAM_CONTINUATION,
          },
        ],
      })
      const context = yield* session.context(sessionID)
      expect(context).toMatchObject([
        { type: "user", text: "Continue partial output" },
        {
          type: "assistant",
          finish: "error",
          error: { type: "provider.invalid-output" },
          content: [{ type: "text", text: "Partial" }],
        },
        {
          type: "synthetic",
          text: INCOMPLETE_STREAM_CONTINUATION,
        },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: " continuation" }] },
      ])
      const assistants = context.filter((message) => message.type === "assistant")
      expect(new Set(assistants.map((message) => message.id)).size).toBe(2)
      expect(context.find((message) => message.type === "synthetic")?.description).toBeUndefined()
      expect(yield* recordedEventTypes(sessionID)).toContain("session.retry.scheduled.1")
      yield* replaySessionProjection(sessionID)
      expect(yield* session.context(sessionID)).toMatchObject(context)
    }),
  )

  it.effect("continues an unknown finish after observable text", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Continue unknown finish")
      yield* TestLLM.push([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "unknown-partial" }),
        LLMEvent.textDelta({ id: "unknown-partial", text: "Partial" }),
        LLMEvent.textEnd({ id: "unknown-partial" }),
        LLMEvent.stepFinish({ index: 0, reason: { normalized: "unknown" } }),
        LLMEvent.finish({ reason: { normalized: "unknown" } }),
      ])
      yield* TestLLM.push(TestLLM.text(" continuation", "unknown-continuation"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)

      expect(requests).toHaveLength(2)
      expect(requests[1]?.messages.at(-1)).toMatchObject({
        role: "user",
        content: [{ type: "text", text: INCOMPLETE_STREAM_CONTINUATION }],
      })
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        { type: "assistant", finish: "error", content: [{ type: "text", text: "Partial" }] },
        { type: "synthetic", text: INCOMPLETE_STREAM_CONTINUATION },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: " continuation" }] },
      ])
    }),
  )

  it.effect("lowers interrupted reasoning before continuing an incomplete stream", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Continue interrupted reasoning")
      yield* TestLLM.push(
        TestLLM.failAfter(
          incompleteStream(),
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.reasoningStart({ id: "partial-reasoning" }),
          LLMEvent.reasoningDelta({ id: "partial-reasoning", text: "Partial thought" }),
        ),
      )
      yield* TestLLM.push(TestLLM.text("Recovered", "reasoning-recovery"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)

      expect(requests[1]?.messages.at(-2)).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "Partial thought" }],
      })
      expect(requests[1]?.messages.at(-1)).toMatchObject({
        role: "user",
        content: [
          {
            type: "text",
            text: INCOMPLETE_STREAM_CONTINUATION,
          },
        ],
      })
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        { type: "assistant", finish: "error", content: [{ type: "reasoning", text: "Partial thought" }] },
        { type: "synthetic" },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Recovered" }] },
      ])
    }),
  )

  it.effect("continues after a transport read failure with durable reasoning state", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Recover disconnected reasoning")
      yield* TestLLM.push(
        TestLLM.failAfter(
          streamDisconnected(),
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.reasoningStart({
            id: "disconnected-reasoning",
            providerMetadata: {
              openai: { itemId: "rs_disconnected", reasoningEncryptedContent: "encrypted-state" },
            },
          }),
        ),
      )
      yield* TestLLM.push(TestLLM.text("Recovered", "reasoning-transport-recovery"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)

      expect(requests).toHaveLength(2)
      expect(yield* recordedEventTypes(sessionID)).toContain("session.retry.scheduled.1")
      expect(requests[1]?.messages.slice(-2)).toMatchObject([
        { role: "user", content: [{ type: "text", text: "Recover disconnected reasoning" }] },
        { role: "user", content: [{ type: "text", text: INCOMPLETE_STREAM_CONTINUATION }] },
      ])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        {
          type: "assistant",
          finish: "error",
          content: [
            {
              type: "reasoning",
              text: "",
              state: { itemId: "rs_disconnected", reasoningEncryptedContent: "encrypted-state" },
            },
          ],
        },
        { type: "synthetic", text: INCOMPLETE_STREAM_CONTINUATION },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Recovered" }] },
      ])
    }),
  )

  it.effect("continues an incomplete stream after settling a local tool", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Continue after tool")
      yield* TestLLM.push(
        TestLLM.failAfter(
          incompleteStream(),
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-before-close", name: "echo", input: { text: "settled" } }),
        ),
      )
      yield* TestLLM.push(TestLLM.text("Recovered", "tool-recovery"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      while (!(yield* recordedEventTypes(sessionID)).includes("session.retry.scheduled.1")) yield* Effect.yieldNow
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)

      expect(executions).toEqual(["settled"])
      expect(requests[1]?.messages.slice(-3)).toMatchObject([
        {
          role: "assistant",
          content: [{ type: "tool-call", id: "call-before-close", name: "echo", input: { text: "settled" } }],
        },
        { role: "tool", content: [{ type: "tool-result", id: "call-before-close" }] },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: INCOMPLETE_STREAM_CONTINUATION,
            },
          ],
        },
      ])
    }),
  )

  it.effect("continues an incomplete stream after settling a local tool defect", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Continue after tool defect")
      yield* TestLLM.push(
        TestLLM.failAfter(
          incompleteStream(),
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-defect-before-close", name: "defect", input: {} }),
        ),
      )
      yield* TestLLM.push(TestLLM.text("Recovered", "tool-defect-recovery"))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      while (!(yield* recordedEventTypes(sessionID)).includes("session.retry.scheduled.1")) yield* Effect.yieldNow
      yield* TestClock.adjust("2400 millis")
      yield* Fiber.join(run)

      expect(messageRoles(requests[1])).toEqual(["user", "assistant", "tool", "user"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-defect-before-close",
              state: { status: "error", error: { type: "unknown", message: "unexpected tool defect" } },
            },
          ],
        },
        { type: "synthetic", text: INCOMPLETE_STREAM_CONTINUATION },
        { type: "assistant", finish: "stop", content: [{ type: "text", text: "Recovered" }] },
      ])
    }),
  )

  it.effect("stops incomplete stream continuations after five total attempts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Exhaust partial continuations")
      const failure = incompleteStream()
      yield* TestLLM.always(
        TestLLM.failAfter(
          failure,
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "partial-exhaustion" }),
          LLMEvent.textDelta({ id: "partial-exhaustion", text: "Partial" }),
        ),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      for (const [index, delay] of [2_400, 4_800, 9_600, 19_200].entries()) {
        yield* TestClock.adjust(delay)
        yield* TestLLM.wait(index + 2)
      }
      expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)
      expect(requests).toHaveLength(5)
      const context = yield* session.context(sessionID)
      expect(context.filter((message) => message.type === "assistant")).toHaveLength(5)
      expect(context.filter((message) => message.type === "synthetic")).toHaveLength(4)
    }),
  )

  it.effect("stops after five total retry attempts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Exhaust retries")
      const failure = providerUnavailable()
      yield* TestLLM.always(Stream.fail(failure))

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      for (const [index, delay] of [2_400, 4_800, 9_600, 19_200].entries()) {
        yield* TestClock.adjust(delay)
        yield* TestLLM.wait(index + 2)
      }
      expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)
      expect(requests).toHaveLength(5)

      const database = (yield* Database.Service).db
      const retries = yield* database
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.type, "session.retry.scheduled.1"))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      for (const [index, range] of [
        [1_600, 2_400],
        [4_800, 7_200],
        [11_200, 16_800],
        [24_000, 36_000],
      ].entries()) {
        expect(retries[index]?.data.at).toBeGreaterThanOrEqual(range[0]!)
        expect(retries[index]?.data.at).toBeLessThanOrEqual(range[1]!)
      }
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

  it.effect("retries a model call without consuming the logical agent step", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.steps = 2
        }),
      )
      yield* admit(session, "Retry without consuming a step")
      const failure = providerUnavailable()
      yield* TestLLM.push(Stream.fail(failure))
      yield* TestLLM.push(TestLLM.tool("call-after-retry", "echo", { text: "recovered" }), TestLLM.stop())

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* TestLLM.wait(1)
      yield* TestClock.adjust("2400 millis")
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
      // The final step keeps tool definitions to preserve provider prompt caching.
      expect(requests[2]?.tools.map((tool) => tool.name)).toContain("echo")
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
      const failure = invalidRequest()
      yield* TestLLM.push(Stream.fail(failure))

      expect(yield* runPrompt(session, "Do not retry").pipe(Effect.flip)).toBe(failure)
      expect(requests).toHaveLength(1)
      expect(yield* recordedEventTypes(sessionID)).not.toContain("session.retry.scheduled.1")
    }),
  )

  it.effect("settles malformed streamed tool input before the provider failure", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const failure = new AIError({
        module: "test",
        method: "stream",
        reason: new InvalidProviderOutputReason({ message: "Invalid JSON input for tool call echo" }),
      })
      yield* TestLLM.push(
        TestLLM.failAfter(
          failure,
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolInputStart({ id: "call-malformed", name: "echo" }),
          LLMEvent.toolInputDelta({ id: "call-malformed", name: "echo", text: '{"text":"partial' }),
        ),
      )

      expect(yield* runPrompt(session, "Call a malformed tool").pipe(Effect.flip)).toBe(failure)
      const assistant = requireAssistant(yield* session.context(sessionID))

      yield* TestLLM.push(TestLLM.stop())
      yield* runPrompt(session, "Continue")

      expect(yield* recordedStepSettlementEvents(sessionID, assistant.id)).toMatchObject([
        { type: "session.step.started.1" },
        {
          type: "session.tool.failed.2",
          data: {
            id: "call-malformed",
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

  it.effect("continues after malformed local tool input without exposing raw arguments", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const marker = "raw-malformed-marker"
      const raw = `{"text":"${marker}`
      yield* TestLLM.push(
        TestLLM.toolCalls(
          LLMEvent.toolInputStart({ id: "call-malformed", name: "echo" }),
          LLMEvent.toolInputDelta({ id: "call-malformed", name: "echo", text: raw }),
          LLMEvent.toolInputEnd({ id: "call-malformed", name: "echo" }),
          LLMEvent.toolInputError({
            id: "call-malformed",
            name: "echo",
            raw,
          }),
        ),
        TestLLM.stop(),
      )

      yield* runPrompt(session, "Recover malformed tool input")

      expect(requests).toHaveLength(2)
      expect(executions).toEqual([])
      expect(JSON.stringify(requests[1])).not.toContain(marker)
      expect(requests[1]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([
              expect.objectContaining({ type: "tool-call", id: "call-malformed", name: "echo", input: {} }),
            ]),
          }),
          expect.objectContaining({
            role: "tool",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-result",
                id: "call-malformed",
                result: expect.objectContaining({
                  type: "error",
                  value: expect.objectContaining({
                    error: expect.objectContaining({
                      message: "Tool call arguments were malformed JSON and were not executed. Retry with valid JSON.",
                    }),
                  }),
                }),
              }),
            ]),
          }),
        ]),
      )
      const context = yield* session.context(sessionID)
      const failed = context.find(
        (message): message is SessionMessage.Assistant =>
          message.type === "assistant" && message.content.some((item) => item.type === "tool"),
      )
      expect(failed).toMatchObject({
        content: [
          {
            type: "tool",
            id: "call-malformed",
            executed: false,
            state: {
              status: "error",
              input: {},
              error: {
                type: "tool.input-json",
                message: "Tool call arguments were malformed JSON and were not executed. Retry with valid JSON.",
              },
            },
          },
        ],
      })
      if (!failed) throw new Error("Malformed tool assistant missing")
      expect(failed.error).toBeUndefined()
      expect(yield* recordedStepSettlementTypes(sessionID, failed.id)).toEqual([
        "session.step.started.1",
        "session.tool.failed.2",
        "session.step.ended.1",
      ])
      const database = (yield* Database.Service).db
      const durable = yield* database
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(durable.find((event) => event.type === "session.tool.input.ended.1")?.data).toMatchObject({
        id: "call-malformed",
        text: raw,
      })
    }),
  )

  it.effect("settles a valid sibling before recovering malformed tool input", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Run parallel tools")
      const tools = yield* blockTools()
      yield* TestLLM.push(
        TestLLM.toolCalls(
          LLMEvent.toolCall({ id: "call-valid", name: "echo", input: { text: "valid" } }),
          LLMEvent.toolInputError({
            id: "call-malformed",
            name: "echo",
            raw: '{"text":"partial',
          }),
        ),
        TestLLM.stop(),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* tools.started
      expect(requests).toHaveLength(1)
      yield* tools.release
      yield* Fiber.join(run)

      expect(requests).toHaveLength(2)
      expect(executions).toEqual(["valid"])
      const request = requests[1]
      if (!request) throw new Error("Malformed recovery request missing")
      expect(request.messages.flatMap((message) => (message.role === "tool" ? message.content : []))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "call-valid", type: "tool-result" }),
          expect.objectContaining({ id: "call-malformed", type: "tool-result" }),
        ]),
      )
    }),
  )

  it.effect("does not recover malformed input after sibling execution is interrupted", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Interrupt malformed recovery")
      const tools = yield* blockTools()
      yield* TestLLM.push(
        TestLLM.toolCalls(
          LLMEvent.toolCall({ id: "call-valid", name: "echo", input: { text: "blocked" } }),
          LLMEvent.toolInputError({
            id: "call-malformed",
            name: "echo",
            raw: '{"text":"partial',
          }),
        ),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* tools.started
      while (
        !(yield* session.context(sessionID)).some(
          (message) =>
            message.type === "assistant" &&
            message.content.some((item) => item.type === "tool" && item.id === "call-malformed"),
        )
      )
        yield* Effect.yieldNow
      yield* session.interrupt(sessionID)

      expect(yield* Fiber.await(run)).toMatchObject({ _tag: "Failure" })
      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Interrupt malformed recovery" },
        {
          type: "assistant",
          error: { type: "aborted", message: "Step interrupted" },
          content: [
            { type: "tool", id: "call-valid", state: { status: "error", error: { type: "aborted" } } },
            { type: "tool", id: "call-malformed", state: { status: "error" } },
          ],
        },
      ])
    }),
  )

  it.effect("records malformed provider-executed input as executed", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const failure = new AIError({
        module: "test",
        method: "stream",
        reason: new InvalidProviderOutputReason({ message: "Invalid hosted tool input" }),
      })
      yield* TestLLM.push(
        TestLLM.failAfter(
          failure,
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolInputStart({ id: "call-hosted", name: "web_search", providerExecuted: true }),
          LLMEvent.toolInputDelta({ id: "call-hosted", name: "web_search", text: '{"query":"partial' }),
        ),
      )

      expect(yield* runPrompt(session, "Fail malformed hosted input").pipe(Effect.flip)).toBe(failure)
      expect(requireAssistant(yield* session.context(sessionID))).toMatchObject({
        error: { type: "provider.invalid-output", message: "Invalid hosted tool input" },
        content: [
          {
            type: "tool",
            id: "call-hosted",
            executed: true,
            state: { status: "error", error: { type: "provider.invalid-output" } },
          },
        ],
      })
    }),
  )

  it.effect("records a provider failure after malformed input", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const failure = new AIError({
        module: "test",
        method: "stream",
        reason: new InvalidProviderOutputReason({ message: "Provider failed after malformed input" }),
      })
      yield* TestLLM.push(
        TestLLM.failAfter(
          failure,
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolInputError({
            id: "call-malformed",
            name: "echo",
            raw: '{"text":"partial',
          }),
        ),
      )

      expect(yield* runPrompt(session, "Fail after malformed input").pipe(Effect.flip)).toBe(failure)
      expect(requireAssistant(yield* session.context(sessionID))).toMatchObject({
        error: { type: "provider.invalid-output", message: "Provider failed after malformed input" },
        content: [
          {
            type: "tool",
            id: "call-malformed",
            executed: false,
            state: { status: "error", error: { type: "tool.input-json" } },
          },
        ],
      })
      expect(requests).toHaveLength(1)
    }),
  )

  it.effect("continues after repeated malformed tool input", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const malformed = (id: string) =>
        TestLLM.toolCalls(
          LLMEvent.toolInputError({
            id,
            name: "echo",
            raw: '{"text":"partial',
          }),
        )
      yield* TestLLM.push(
        malformed("call-first"),
        TestLLM.tool("call-valid-between", "echo", { text: "valid" }),
        malformed("call-second"),
        TestLLM.stop(),
      )

      yield* runPrompt(session, "Keep producing malformed tools")

      expect(requests).toHaveLength(4)
      expect(executions).toEqual(["valid"])
      expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.step.failed.1")).toHaveLength(0)
    }),
  )

  it.effect("does not continue malformed tool input past the agent step limit", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.steps = 2
        }),
      )
      const malformed = (id: string) =>
        TestLLM.toolCalls(
          LLMEvent.toolInputError({
            id,
            name: "echo",
            raw: '{"text":"partial',
          }),
        )
      yield* TestLLM.push(malformed("call-first"), malformed("call-at-limit"))

      yield* runPrompt(session, "Stop malformed tools at the step limit")

      expect(requests).toHaveLength(2)
      expect(requests[0]?.toolChoice).toBeUndefined()
      expect(requests[1]?.toolChoice).toMatchObject({ type: "none" })
      expect((yield* recordedEventTypes(sessionID)).filter((type) => type === "session.tool.failed.2")).toHaveLength(2)
    }),
  )

  it.effect("does not continue automatically after a provider error follows a local tool call", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Do not continue failed provider")
      const tools = yield* blockTools()
      yield* TestLLM.push([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-before-provider-error", name: "echo", input: { text: "settled" } }),
        LLMEvent.providerError({ message: "Provider unavailable" }),
      ])

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* tools.started
      yield* tools.release
      expect((yield* Fiber.join(run).pipe(Effect.flip)).message).toBe("Provider unavailable")

      expect(requests).toHaveLength(1)
      expect(executions).toEqual(["settled"])
      const context = yield* session.context(sessionID)
      const assistant = requireAssistant(context)
      expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.success.2",
        "session.step.failed.1",
      ])
    }),
  )

  it.effect("durably fails a hosted tool when its provider errors before returning a result", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push([
        LLMEvent.stepStart({ index: 0 }),
        hostedCall("call-hosted-provider-error", "effect"),
        LLMEvent.providerError({ message: "Provider unavailable" }),
      ])

      expect((yield* runPrompt(session, "Fail hosted tool durably").pipe(Effect.flip)).message).toBe(
        "Provider unavailable",
      )

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
      expect(yield* recordedStepSettlementTypes(sessionID, assistant.id)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.2",
        "session.step.failed.1",
      ])
    }),
  )

  it.effect("preserves a tool defect before provider failure settlement", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-defect-provider-error", name: "defect", input: {} }),
        LLMEvent.providerError({ message: "Provider unavailable" }),
      ])

      expect((yield* runPrompt(session, "Defect while provider fails").pipe(Effect.flip)).message).toBe(
        "Provider unavailable",
      )

      const context = yield* session.context(sessionID)
      const assistant = requireAssistant(context)
      const bus = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(bus.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.2",
        "session.step.failed.1",
      ])
      expect(bus[2]?.data.error).toMatchObject({ type: "unknown", message: "unexpected tool defect" })
    }),
  )

  it.effect("preserves the provider failure when tool output persistence also fails", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Storage fails while provider fails")
      yield* TestLLM.push([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call-store-provider-error", name: "storefail", input: {} }),
        LLMEvent.providerError({ message: "Provider unavailable" }),
      ])

      expect(yield* session.resume(sessionID).pipe(Effect.exit)).toMatchObject({
        _tag: "Failure",
      })

      expect(requireAssistant(yield* session.context(sessionID))).toMatchObject({
        error: { type: "provider.unknown", message: "Provider unavailable" },
      })
    }),
  )

  it.effect("durably fails a hosted tool left unresolved at normal provider EOF", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push([LLMEvent.stepStart({ index: 0 }), hostedCall("call-hosted-eof", "effect")])

      expect((yield* runPrompt(session, "Fail hosted tool at EOF").pipe(Effect.flip)).message).toBe(
        "Provider did not return a tool result",
      )
      const assistant = requireAssistant(yield* session.context(sessionID))
      const bus = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(bus.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.2",
        "session.step.failed.1",
      ])
      expect(
        bus.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
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
      yield* TestLLM.push(TestLLM.stop(hostedCall("call-hosted-clean-end", "effect")))

      yield* runPrompt(session, "Settle hosted tool before ending")

      const assistant = requireAssistant(yield* session.context(sessionID))
      const bus = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(bus.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.2",
        "session.step.ended.1",
      ])
      expect(
        bus.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
      ).toHaveLength(1)
    }),
  )

  it.effect("settles unresolved local and hosted tools before one raw provider failure", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* admit(session, "Fail unresolved tools")
      const failure = invalidRequest()
      const providerFailed = yield* Deferred.make<void>()
      const tools = yield* blockTools()
      yield* TestLLM.push(
        Stream.concat(
          Stream.fromIterable([
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.toolCall({ id: "call-local-raw-failure", name: "defect", input: {} }),
            hostedCall("call-hosted-raw-failure-pair", "effect"),
          ]),
          Stream.fromEffect(Deferred.succeed(providerFailed, undefined)).pipe(
            Stream.flatMap(() => Stream.fail(failure)),
          ),
        ),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(providerFailed)
      yield* tools.release
      expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)

      const assistant = requireAssistant(yield* session.context(sessionID))
      const bus = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(bus.map((event) => ({ type: event.type, id: event.data.id }))).toEqual([
        { type: "session.step.started.1", id: undefined },
        { type: "session.tool.called.1", id: "call-local-raw-failure" },
        { type: "session.tool.called.1", id: "call-hosted-raw-failure-pair" },
        { type: "session.tool.failed.2", id: "call-local-raw-failure" },
        { type: "session.tool.failed.2", id: "call-hosted-raw-failure-pair" },
        { type: "session.step.failed.1", id: undefined },
      ])
      expect(
        bus.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
      ).toHaveLength(1)
    }),
  )

  it.effect("durably fails a hosted tool left unresolved by a raw provider stream failure", () =>
    Effect.gen(function* () {
      const session = yield* setup
      const failure = providerUnavailable()
      yield* TestLLM.push(
        Stream.concat(
          Stream.fromIterable([LLMEvent.stepStart({ index: 0 }), hostedCall("call-hosted-raw-failure", "effect")]),
          Stream.fail(failure),
        ),
      )

      expect(yield* runPrompt(session, "Fail hosted tool on raw failure").pipe(Effect.flip)).toBe(failure)
      expect(requests).toHaveLength(1)
      const assistant = requireAssistant(yield* session.context(sessionID))
      const bus = yield* recordedStepSettlementEvents(sessionID, assistant.id)
      expect(bus.map((event) => event.type)).toEqual([
        "session.step.started.1",
        "session.tool.called.1",
        "session.tool.failed.2",
        "session.step.failed.1",
      ])
      expect(
        bus.filter((event) => event.type.startsWith("session.step.") && event.type !== "session.step.started.1"),
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
      yield* TestLLM.push([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-1" }),
        LLMEvent.textStart({ id: "text-2" }),
      ])

      const defect = yield* runPrompt(session, "Two blocks").pipe(Effect.catchDefect(Effect.succeed))
      expect(defect).toBeInstanceOf(Error)
      if (!(defect instanceof Error)) return
      expect(defect.message).toBe("text start before end: text-2")
    }),
  )

  it.effect("projects sequential text fragments as separate content parts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(
        TestLLM.stop(
          LLMEvent.textStart({ id: "text-1" }),
          LLMEvent.textDelta({ id: "text-1", text: "First" }),
          LLMEvent.textEnd({ id: "text-1" }),
          LLMEvent.textStart({ id: "text-2" }),
          LLMEvent.textDelta({ id: "text-2", text: "Second" }),
          LLMEvent.textEnd({ id: "text-2" }),
        ),
      )

      yield* runPrompt(session, "Two blocks")

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
    it.effect(
      kind === "tool input"
        ? "does not broadcast provider tool input deltas"
        : `batches provider ${kind} deltas without storing projection rewrites`,
      () => verifyEphemeralDeltas(kind),
    )

    it.effect(`durably closes partial ${kind} when the provider stream fails`, () => verifyPartialFlushOnFailure(kind))

    it.effect(`durably closes partial ${kind} when the provider stream is interrupted`, () =>
      verifyPartialFlushOnInterruption(kind),
    )
  }

  it.effect("rejects duplicate streamed text starts", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push([LLMEvent.textStart({ id: "text-1" }), LLMEvent.textStart({ id: "text-1" })])

      const defect = yield* session.resume(sessionID).pipe(Effect.catchDefect(Effect.succeed))
      expect(defect).toBeInstanceOf(Error)
      if (!(defect instanceof Error)) return
      expect(defect.message).toBe("Duplicate text start: text-1")
    }),
  )

  it.effect("transitions streamed raw tool input to parsed called input", () =>
    Effect.gen(function* () {
      const session = yield* setup
      yield* TestLLM.push(
        TestLLM.stop(
          LLMEvent.toolInputStart({ id: "call-parsed", name: "web_search" }),
          LLMEvent.toolInputDelta({ id: "call-parsed", name: "web_search", text: '{"query":"hello"}' }),
          LLMEvent.toolInputEnd({ id: "call-parsed", name: "web_search" }),
          hostedCall("call-parsed", "hello"),
        ),
      )

      yield* runPrompt(session, "Call provider tool")

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
      yield* TestLLM.push([LLMEvent.toolInputDelta({ id: "call-1", name: "read", text: "{}" })])

      const defect = yield* session.resume(sessionID).pipe(Effect.catchDefect(Effect.succeed))
      expect(defect).toBeInstanceOf(Error)
      if (!(defect instanceof Error)) return
      expect(defect.message).toBe("Tool input delta before start: call-1")
    }),
  )
})
