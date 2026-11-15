import { expect } from "bun:test"
import {
  AIError,
  LLMClient,
  LLMEvent,
  LLMResponse,
  LanguageModel,
  Message,
  SystemPart,
  ToolDefinition,
  TransportError,
  type LLMRequest,
} from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import type { StreamOptions } from "@opencode/ai/route"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { EventTable } from "@opencode/core/event/sql"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Instance } from "@opencode/core/instance/service"
import { Instructions } from "@opencode/core/instructions/index"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { Location } from "@opencode/core/location"
import { McpInstructions } from "@opencode/core/mcp/instructions"
import { ID } from "@opencode/core/model"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { ReferenceInstructions } from "@opencode/core/reference/instructions"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionContext } from "@opencode/core/session/context"
import { SessionGenerate } from "@opencode/core/session/generate"
import { InstructionState } from "@opencode/core/session/instruction-state"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionSchema } from "@opencode/core/session/schema"
import {
  InstructionBlobTable,
  InstructionStateTable,
  SessionMessageTable,
  SessionInboxTable,
  SessionTable,
} from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SkillInstructions } from "@opencode/core/skill/instructions"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Tool } from "@opencode/core/tool"
import { Money } from "@opencode/schema/money"
import { asc, eq } from "drizzle-orm"
import { Effect, Fiber, Layer, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"

const requests: LLMRequest[] = []
const options: Array<StreamOptions | undefined> = []
let instruction: string | Instructions.Unavailable = "Initial context"
const sessionID = SessionSchema.ID.make("ses_generate_test")

const model = LanguageModel.make({ id: "generate-model", provider: "test", route: OpenAIChat.route })
const client = Layer.mock(LLMClient.Service)({
  stream: () => Stream.die(new Error("unused")),
  generate: (request, requestOptions) =>
    Effect.sync(() => {
      requests.push(request)
      options.push(requestOptions)
      const response = LLMResponse.fromEvents([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "generate" }),
        LLMEvent.textDelta({ id: "generate", text: "Transient answer" }),
        LLMEvent.textEnd({ id: "generate" }),
        LLMEvent.stepFinish({
          index: 0,
          reason: { normalized: "stop" },
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            nonCachedInputTokens: 60,
            cacheReadInputTokens: 30,
            cacheWriteInputTokens: 10,
          },
        }),
        LLMEvent.finish({ reason: { normalized: "stop" } }),
      ])
      if (!response) throw new Error("Incomplete generate response")
      return response
    }),
})
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: () =>
    Effect.succeed(
      SessionRunnerModel.resolved(model, {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [
          {
            input: Money.USDPerMillionTokens.make(1),
            output: Money.USDPerMillionTokens.make(2),
            cache: { read: Money.USDPerMillionTokens.make(0.1), write: Money.USDPerMillionTokens.make(0.5) },
          },
        ],
        limit: { context: 200_000, output: 32_000 },
      }),
    ),
})
const builtins = Layer.mock(InstructionBuiltIns.Service, {
  load: () =>
    Effect.succeed(
      Instructions.make({
        key: Instructions.Key.make("test/context"),
        codec: Schema.toCodecJson(Schema.String),
        read: Effect.sync(() => instruction),
        render: {
          initial: String,
          changed: (_previous, current) => current,
        },
      }),
    ),
})
const discovery = Layer.mock(InstructionDiscovery.Service, {
  project: true,
  global: true,
  load: () => Effect.succeed(Instructions.empty),
})
const skills = Layer.mock(SkillInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const references = Layer.mock(ReferenceInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const mcp = Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const tools = Layer.mock(Tool.Service, {
  snapshot: () =>
    Effect.succeed({
      codeModeCatalog: {
        tools: [
          {
            type: "tool",
            name: "captured.lookup",
            description: "Captured Code Mode catalog",
            signature: "tools.captured.lookup(): Promise<string>",
          },
        ],
      },
      definitions: [ToolDefinition.make({ name: "lookup", description: "Lookup", inputSchema: { type: "object" } })],
      execute: () => Effect.die(new Error("unused")),
    }),
  transform: () => Effect.die(new Error("unused")),
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Project.node,
      SessionProjector.node,
      SessionStore.node,
      Agent.node,
      InstructionBuiltIns.node,
      SessionContext.node,
      PluginHooks.node,
      llmClient,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      llmClient.replace(client),
      SessionRunnerModel.node.replace(models),
      InstructionBuiltIns.node.replace(builtins),
      InstructionDiscovery.node.replace(discovery),
      SkillInstructions.node.replace(skills),
      ReferenceInstructions.node.replace(references),
      McpInstructions.node.replace(mcp),
      PluginSupervisor.node.replace(Layer.empty),
      Tool.node.replace(tools),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    ],
  ),
)

// Session history generation must leave untouched; usage accounting is checked separately.
const durableState = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  Effect.all({
    messages: db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, sessionID))
      .orderBy(asc(SessionMessageTable.seq))
      .all()
      .pipe(Effect.orDie),
    pending: db
      .select()
      .from(SessionInboxTable)
      .where(eq(SessionInboxTable.session_id, sessionID))
      .orderBy(asc(SessionInboxTable.enqueued_seq))
      .all()
      .pipe(Effect.orDie),
    instructions: db
      .select()
      .from(InstructionStateTable)
      .where(eq(InstructionStateTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie),
    blobs: db.select().from(InstructionBlobTable).orderBy(asc(InstructionBlobTable.hash)).all().pipe(Effect.orDie),
  })

const usageState = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  Effect.all({
    sequence: Bus.latestSequence(db, sessionID),
    events: db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie),
    session: db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie),
  })

const recordedUsage = (
  before: Effect.Success<ReturnType<typeof usageState>>,
  after: Effect.Success<ReturnType<typeof usageState>>,
) => after.events.slice(before.events.length).map((event) => ({ type: event.type, data: event.data }))

const userTexts = (request: LLMRequest) =>
  request.messages.flatMap((message) =>
    message.role === "user"
      ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : []))
      : [],
  )

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const bus = yield* Bus.Service
  const agents = yield* Agent.Service
  const projects = yield* Project.Service
  const instructionBuiltIns = yield* InstructionBuiltIns.Service
  const context = yield* SessionContext.Service
  const store = yield* SessionStore.Service
  yield* agents.transform((editor) =>
    editor.update(Agent.ID.make("build"), (agent) => {
      agent.mode = "primary"
    }),
  )
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: (yield* projects.resolve(AbsolutePath.make("/project"))).id,
      slug: "generate-test",
      directory: "/project",
      title: "Generate test",
      version: "test",
      agent: Agent.ID.make("build"),
    })
    .run()
    .pipe(Effect.orDie)
  const session = yield* store.get(sessionID)
  if (!session) return yield* Effect.die("Session fixture missing")
  return {
    db,
    bus,
    session,
    instructions: yield* instructionBuiltIns.load(),
    instances: Instance.Service.of({
      // Generation only exercises the Location's model context.
      provide: () =>
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(SessionContext.Service, context),
            Layer.mock(Plugin.Service, { awaitActivation: Effect.void }),
          ) as Layer.Layer<Instance.Services>,
        ),
    }),
  }
})

it.effect(
  "generates from fresh settled Session context and records only its usage",
  () =>
    Effect.gen(function* () {
      requests.length = 0
      options.length = 0
      instruction = "Initial context"
      const { db, bus, instructions, session, instances } = yield* setup
      yield* InstructionState.prepare(db, bus, instructions, sessionID)
      const existing = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID,
        inboxID: existing,
        item: { type: "user", payload: { text: "Existing durable context" }, delivery: "steer" },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, {
        sessionID,
        inboxID: existing,
      })
      const settledAssistant = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: settledAssistant,
        agent: Agent.ID.make("build"),
        model: { id: ID.make("generate-model"), providerID: Provider.ID.make("test") },
        started: 0,
      })
      yield* bus.publish(SessionEvent.Text.Started, {
        sessionID,
        assistantMessageID: settledAssistant,
        ordinal: 0,
      })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID,
        assistantMessageID: settledAssistant,
        ordinal: 0,
        text: "Settled partial answer",
      })
      const activeAssistant = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: activeAssistant,
        agent: Agent.ID.make("build"),
        model: { id: ID.make("generate-model"), providerID: Provider.ID.make("test") },
        started: 0,
      })
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID: activeAssistant,
        id: "active-call",
        name: "echo",
      })
      yield* bus.publish(SessionEvent.Tool.Input.Ended, {
        sessionID,
        assistantMessageID: activeAssistant,
        id: "active-call",
        text: "{}",
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID: activeAssistant,
        id: "active-call",
        input: {},
        executed: false,
      })
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID,
        inboxID: SessionMessage.ID.create(),
        item: { type: "user", payload: { text: "Queued input must remain invisible" }, delivery: "queue" },
      })
      instruction = "Changed context"
      const before = yield* durableState(db, sessionID)
      const usageBefore = yield* usageState(db, sessionID)

      const result = yield* SessionGenerate.generate({ session, prompt: "Summarize privately" }).pipe(
        Effect.provideService(Instance.Service, instances),
      )

      expect(result.text).toBe("Transient answer")
      expect(result.tokens).toEqual({ input: 60, output: 10, reasoning: 0, cache: { read: 30, write: 10 } })
      expect(result.cost).toBeCloseTo(0.000088)
      expect(requests).toHaveLength(1)
      expect(requests[0]?.model).toBe(model)
      expect(requests[0]?.system.map((part) => part.text)).toContain("Initial context")
      expect(requests[0]?.headers).toMatchObject({ "X-Session-Id": sessionID })
      expect(requests[0]?.promptCacheKey).toBe(sessionID)
      const instructionUpdates = requests[0]?.messages.flatMap((message) =>
        message.role === "system"
          ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : []))
          : [],
      )
      expect(instructionUpdates).toHaveLength(1)
      expect(instructionUpdates?.[0]).toContain("Changed context")
      expect(instructionUpdates?.[0]).toContain("tools.captured.lookup(): Promise<string>")
      expect(userTexts(requests[0])).toEqual(["Existing durable context", "Summarize privately"])
      expect(
        requests[0]?.messages.flatMap((message) =>
          message.role === "assistant"
            ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : []))
            : [],
        ),
      ).toEqual(["Settled partial answer"])
      expect(requests[0]?.tools).toMatchObject([{ name: "lookup", description: "Lookup" }])
      expect(requests[0]?.toolChoice).toBeUndefined()
      expect(options[0]?.webSocket).toBeUndefined()
      expect(yield* durableState(db, sessionID)).toEqual(before)
      const usageAfter = yield* usageState(db, sessionID)
      expect(recordedUsage(usageBefore, usageAfter)).toEqual([
        {
          type: Event.versionedType(SessionEvent.UsageRecorded.type, SessionEvent.UsageRecorded.durable.version),
          data: { sessionID, source: "generate", cost: result.cost, tokens: result.tokens },
        },
      ])
      expect(usageAfter.session?.cost).toBeCloseTo((usageBefore.session?.cost ?? 0) + result.cost)
      expect(usageAfter.session).toMatchObject({
        tokens_input: (usageBefore.session?.tokens_input ?? 0) + 60,
        tokens_output: (usageBefore.session?.tokens_output ?? 0) + 10,
        tokens_reasoning: usageBefore.session?.tokens_reasoning ?? 0,
        tokens_cache_read: (usageBefore.session?.tokens_cache_read ?? 0) + 30,
        tokens_cache_write: (usageBefore.session?.tokens_cache_write ?? 0) + 10,
      })
    }),
  { timeout: 15_000 },
)

it.effect(
  "runs generate hooks instead of context hooks",
  () =>
    Effect.gen(function* () {
      requests.length = 0
      instruction = "Initial context"
      const { db, bus, instructions, session, instances } = yield* setup
      yield* InstructionState.prepare(db, bus, instructions, sessionID)
      const hooks = yield* PluginHooks.Service
      let contexts = 0
      yield* hooks.register("session", "context", () => Effect.sync(() => contexts++))
      yield* hooks.register("session", "generate", (event) =>
        Effect.sync(() => {
          expect(event.sessionID).toBe(sessionID)
          expect(event.agent).toBe(Agent.ID.make("build"))
          expect(Object.keys(event.tools)).toEqual(["lookup"])
          event.system.push(SystemPart.make("Answer briefly."))
          event.messages = [Message.user("[redacted]")]
          event.options.maxTokens = 32
          event.options.reasoningEffort = "low"
        }),
      )

      yield* SessionGenerate.generate({ session, prompt: "Summarize privately" }).pipe(
        Effect.provideService(Instance.Service, instances),
      )

      expect(contexts).toBe(0)
      expect(requests).toHaveLength(1)
      expect(requests[0]?.system.map((part) => part.text)).toContain("Answer briefly.")
      expect(userTexts(requests[0])).toEqual(["[redacted]"])
      expect(requests[0]?.maxTokens).toBe(32)
      expect(requests[0]?.providerOptions).toEqual({ reasoningEffort: "low" })
    }),
  { timeout: 15_000 },
)

it.effect("regenerates a failed partial answer without mutating Session history", () =>
  Effect.gen(function* () {
    instruction = "Initial context"
    const { db, bus, instructions, session, instances } = yield* setup
    yield* InstructionState.prepare(db, bus, instructions, sessionID)
    const before = yield* durableState(db, sessionID)
    const usageBefore = yield* usageState(db, sessionID)
    const llm = yield* TestLLM.Test
    yield* llm.push(
      TestLLM.failAfter(
        new AIError({
          reason: new TransportError({ message: "Disconnected", transport: "http", operation: "read" }),
        }),
        LLMEvent.textStart({ id: "failed" }),
        LLMEvent.textDelta({ id: "failed", text: "Discard this" }),
      ),
      TestLLM.text("Fresh answer", "success"),
    )
    const result = yield* SessionGenerate.generate({ session, prompt: "Summarize privately" }).pipe(
      Effect.provideService(Instance.Service, instances),
      Effect.provideService(LLMClient.Service, llm),
      Effect.forkChild({ startImmediately: true }),
    )
    yield* llm.wait(1)
    yield* TestClock.adjust("3 seconds")
    expect((yield* Fiber.join(result)).text).toBe("Fresh answer")
    const requests = yield* llm.requests()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toBe(requests[0])
    expect(userTexts(requests[1])).toContain("Summarize privately")
    expect(yield* durableState(db, sessionID)).toEqual(before)
    // The retried attempt counts once.
    expect(recordedUsage(usageBefore, yield* usageState(db, sessionID))).toHaveLength(1)
  }).pipe(Effect.provide(TestLLM.testLayer())),
)

it.effect(
  "blocks unavailable initial instructions before generation",
  () =>
    Effect.gen(function* () {
      requests.length = 0
      instruction = Instructions.unavailable
      const { db, session, instances } = yield* setup
      const before = yield* durableState(db, sessionID)
      const usageBefore = yield* usageState(db, sessionID)

      const error = yield* SessionGenerate.generate({ session, prompt: "Summarize privately" }).pipe(
        Effect.provideService(Instance.Service, instances),
        Effect.flip,
      )

      expect(error).toBeInstanceOf(Instructions.InitializationBlocked)
      expect(requests).toEqual([])
      expect(yield* durableState(db, sessionID)).toEqual(before)
      expect(yield* usageState(db, sessionID)).toEqual(usageBefore)
    }),
  { timeout: 15_000 },
)
