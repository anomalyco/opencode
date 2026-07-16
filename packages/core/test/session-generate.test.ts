import { expect } from "bun:test"
import { LLMClient, LLMEvent, LLMResponse, Model, SystemPart, type LLMRequest } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { InstructionDiscovery } from "@opencode-ai/core/instruction-discovery"
import { Instructions } from "@opencode-ai/core/instructions"
import { InstructionBuiltIns } from "@opencode-ai/core/instructions/builtins"
import { Location } from "@opencode-ai/core/location"
import { McpInstructions } from "@opencode-ai/core/mcp/instructions"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ReferenceInstructions } from "@opencode-ai/core/reference/instructions"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionGenerate } from "@opencode-ai/core/session/generate"
import { SessionGenerateNode } from "@opencode-ai/core/session/generate-node"
import { InstructionState } from "@opencode-ai/core/session/instruction-state"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import {
  InstructionBlobTable,
  InstructionStateTable,
  SessionMessageTable,
  SessionPendingTable,
  SessionTable,
} from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SkillInstructions } from "@opencode-ai/core/skill/instructions"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { asc, eq } from "drizzle-orm"
import { Effect, Layer, Schema, Stream } from "effect"
import { testEffect } from "./lib/effect"

const requests: LLMRequest[] = []
let instruction: string | Instructions.Unavailable = "Initial context"
const sessionID = SessionSchema.ID.make("ses_generate_test")

const model = Model.make({ id: "generate-model", provider: "test", route: OpenAIChat.route })
const client = Layer.mock(LLMClient.Service)({
  prepare: () => Effect.die(new Error("unused")),
  stream: () => Stream.die(new Error("unused")),
  generate: (request) =>
    Effect.sync(() => {
      requests.push(request)
      const response = LLMResponse.fromEvents([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "generate" }),
        LLMEvent.textDelta({ id: "generate", text: "Transient answer" }),
        LLMEvent.textEnd({ id: "generate" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop", usage: { inputTokens: 100, outputTokens: 10 } }),
        LLMEvent.finish({ reason: "stop" }),
      ])
      if (!response) throw new Error("Incomplete generate response")
      return response
    }),
})
const models = SessionRunnerModel.layerWith(() => Effect.succeed(SessionRunnerModel.resolved(model)))
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
const discovery = Layer.mock(InstructionDiscovery.Service, { load: () => Effect.succeed(Instructions.empty) })
const skills = Layer.mock(SkillInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const references = Layer.mock(ReferenceInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const mcp = Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const plugins = Layer.mock(PluginSupervisor.Service, { flush: Effect.void })

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      InstructionBuiltIns.node,
      PluginHooks.node,
      SessionGenerateNode.node,
    ]),
    [
      [llmClient, client],
      [SessionRunnerModel.node, models],
      [InstructionBuiltIns.node, builtins],
      [InstructionDiscovery.node, discovery],
      [SkillInstructions.node, skills],
      [ReferenceInstructions.node, references],
      [McpInstructions.node, mcp],
      [PluginSupervisor.node, plugins],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
    ],
  ),
)

const durableState = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  Effect.all({
    sequence: EventV2.latestSequence(db, sessionID),
    events: db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie),
    messages: db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, sessionID))
      .orderBy(asc(SessionMessageTable.seq))
      .all()
      .pipe(Effect.orDie),
    pending: db
      .select()
      .from(SessionPendingTable)
      .where(eq(SessionPendingTable.session_id, sessionID))
      .orderBy(asc(SessionPendingTable.admitted_seq))
      .all()
      .pipe(Effect.orDie),
    instructions: db
      .select()
      .from(InstructionStateTable)
      .where(eq(InstructionStateTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie),
    blobs: db.select().from(InstructionBlobTable).orderBy(asc(InstructionBlobTable.hash)).all().pipe(Effect.orDie),
    session: db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie),
  })

const userTexts = (request: LLMRequest) =>
  request.messages.flatMap((message) =>
    message.role === "user"
      ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : []))
      : [],
  )

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  const agents = yield* AgentV2.Service
  const instructionBuiltIns = yield* InstructionBuiltIns.Service
  yield* agents.transform((draft) =>
    draft.update(AgentV2.ID.make("build"), (agent) => {
      agent.mode = "primary"
    }),
  )
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "generate-test",
      directory: "/project",
      title: "Generate test",
      version: "test",
      agent: AgentV2.ID.make("build"),
    })
    .run()
    .pipe(Effect.orDie)
  return { db, events, instructions: yield* instructionBuiltIns.load(sessionID) }
})

it.effect("generates from fresh settled Session context without durable mutation", () =>
  Effect.gen(function* () {
    requests.length = 0
    instruction = "Initial context"
    const { db, events, instructions } = yield* setup
    yield* InstructionState.prepare(db, events, instructions, sessionID)
    const existing = SessionMessage.ID.create()
    yield* events.publish(SessionEvent.InputAdmitted, {
      sessionID,
      inputID: existing,
      input: { type: "user", data: { text: "Existing durable context" }, delivery: "steer" },
    })
    yield* events.publish(SessionEvent.InputPromoted, { sessionID, inputID: existing })
    const settledAssistant = SessionMessage.ID.create()
    yield* events.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID: settledAssistant,
      agent: AgentV2.ID.make("build"),
      model: { id: ModelV2.ID.make("generate-model"), providerID: ProviderV2.ID.make("test") },
    })
    yield* events.publish(SessionEvent.Text.Started, {
      sessionID,
      assistantMessageID: settledAssistant,
      ordinal: 0,
    })
    yield* events.publish(SessionEvent.Text.Ended, {
      sessionID,
      assistantMessageID: settledAssistant,
      ordinal: 0,
      text: "Settled partial answer",
    })
    const activeAssistant = SessionMessage.ID.create()
    yield* events.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID: activeAssistant,
      agent: AgentV2.ID.make("build"),
      model: { id: ModelV2.ID.make("generate-model"), providerID: ProviderV2.ID.make("test") },
    })
    yield* events.publish(SessionEvent.Tool.Input.Started, {
      sessionID,
      assistantMessageID: activeAssistant,
      callID: "active-call",
      name: "echo",
    })
    yield* events.publish(SessionEvent.Tool.Input.Ended, {
      sessionID,
      assistantMessageID: activeAssistant,
      callID: "active-call",
      text: "{}",
    })
    yield* events.publish(SessionEvent.Tool.Called, {
      sessionID,
      assistantMessageID: activeAssistant,
      callID: "active-call",
      input: {},
      executed: false,
    })
    yield* events.publish(SessionEvent.InputAdmitted, {
      sessionID,
      inputID: SessionMessage.ID.create(),
      input: { type: "user", data: { text: "Queued input must remain invisible" }, delivery: "queue" },
    })
    instruction = "Changed context"
    const before = yield* durableState(db, sessionID)
    const hooks = yield* PluginHooks.Service
    yield* hooks.register("session", "context", (event) =>
      Effect.sync(() => {
        event.system = [SystemPart.make("Hooked system"), ...event.system]
      }),
    )

    const generate = yield* SessionGenerate.Service
    const result = yield* generate.generate({ sessionID, prompt: "Summarize privately" })

    expect(result).toBe("Transient answer")
    expect(requests).toHaveLength(1)
    expect(requests[0]?.model).toBe(model)
    expect(requests[0]?.system[0]?.text).toBe("Hooked system")
    expect(requests[0]?.system.map((part) => part.text)).toContain("Initial context")
    expect(requests[0]?.http?.headers).toMatchObject({ "X-Session-Id": sessionID })
    expect(requests[0]?.providerOptions).toMatchObject({ openai: { promptCacheKey: sessionID } })
    expect(
      requests[0]?.messages.flatMap((message) =>
        message.role === "system"
          ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : []))
          : [],
      ),
    ).toEqual(["Changed context"])
    expect(userTexts(requests[0])).toEqual(["Existing durable context", "Summarize privately"])
    expect(
      requests[0]?.messages.flatMap((message) =>
        message.role === "assistant"
          ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : []))
          : [],
      ),
    ).toEqual(["Settled partial answer"])
    expect(requests[0]?.tools).toEqual([])
    expect(requests[0]?.toolChoice).toMatchObject({ type: "none" })
    expect(yield* durableState(db, sessionID)).toEqual(before)
  }),
)

it.effect("blocks unavailable initial instructions before generation", () =>
  Effect.gen(function* () {
    requests.length = 0
    instruction = Instructions.unavailable
    const { db } = yield* setup
    const before = yield* durableState(db, sessionID)
    const generate = yield* SessionGenerate.Service

    const error = yield* generate.generate({ sessionID, prompt: "Summarize privately" }).pipe(Effect.flip)

    expect(error).toBeInstanceOf(Instructions.InitializationBlocked)
    expect(requests).toEqual([])
    expect(yield* durableState(db, sessionID)).toEqual(before)
  }),
)
