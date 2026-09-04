import { expect, test } from "bun:test"
import { CompactionPart, LanguageModel, Message, ToolCallPart } from "@opencode-ai/ai"
import { OpenAIResponses } from "@opencode-ai/ai/protocols"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Instructions } from "@opencode-ai/core/instructions/index"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionHistory } from "@opencode-ai/core/session/history"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { InstructionState } from "@opencode-ai/core/session/instruction-state"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionProviderContext } from "@opencode-ai/core/session/provider-context"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { InstructionStateTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Model } from "@opencode-ai/schema/model"
import { asc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { testEffect } from "./lib/effect"

const model = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "deployment", provider: "openai", route: OpenAIResponses.route }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [],
    limit: { context: 128_000, output: 4096 },
  },
)
const target = SessionProviderContext.provenance(model)
if (!target) throw new Error("Fixture must have a concrete endpoint")
const replacement = [
  Message.user("retained request"),
  Message.system("changed instructions"),
  Message.assistant(
    CompactionPart.make({ provider: model.model.provider, encrypted: "opaque-checkpoint", id: "cp_1" }),
  ),
]
const providerContext = SessionProviderContext.encode(target, replacement)
const sessionID = SessionSchema.ID.make("ses_provider_context")

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionInbox.node, SessionStore.node]),
    [Bus.node.replace(Bus.configured({ persist: true }))],
  ),
)

const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const inbox = yield* SessionInbox.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: Project.ID.global,
    location: { directory: AbsolutePath.make("/project") },
    slug: "provider-context",
    version: "test",
  })
  const state = { value: "initial instructions" }
  const instructions = Instructions.make({
    key: Instructions.Key.make("test/context"),
    codec: Schema.toCodecJson(Schema.String),
    read: Effect.sync(() => state.value),
    render: { initial: String, changed: (_previous, value) => value, removed: () => "removed" },
  })
  const prepare = InstructionState.prepare(database.db, bus, instructions, sessionID)
  const prompt = Effect.fnUntraced(function* (text: string) {
    const id = SessionMessage.ID.create()
    yield* inbox.admit({ id, sessionID, item: { type: "user", payload: { text }, delivery: "steer" } })
    yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: id })
    return id
  })
  const compact = (context?: SessionProviderContext.Info) =>
    bus.publish(SessionEvent.Compaction.Ended, {
      sessionID,
      reason: "manual",
      text: context ? "" : "local summary",
      recent: "",
      providerContext: context,
    })
  const load = (identity?: SessionProviderContext.Provenance) =>
    SessionHistory.entriesForRunner(database.db, sessionID, instructions, identity)
  return { db: database.db, bus, state, instructions, prepare, prompt, compact, load }
})

test("canonical provider context round-trips tools, opaque checkpoints and binary media through JSON", () => {
  const messages = [
    ...replacement,
    Message.assistant(ToolCallPart.make({ id: "call_1", name: "read", input: { path: "file" } })),
    Message.tool({ id: "call_1", name: "read", result: { text: "result" } }),
    Message.user({ type: "media", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) }),
  ]
  const context = SessionProviderContext.encode(providerContext.provenance, messages)
  const stored = Schema.decodeUnknownSync(Schema.fromJsonString(SessionProviderContext.Info))(JSON.stringify(context))
  const decoded = SessionProviderContext.decode(stored)
  expect(decoded.slice(0, -1)).toEqual(messages.slice(0, -1))
  expect(decoded.at(-1)?.content).toEqual([{ type: "media", mediaType: "image/png", data: "AQID" }])
  expect(() =>
    SessionProviderContext.decode({
      ...context,
      messages: [{ role: "assistant", content: [{ type: "compaction", provider: "openai" }] }],
    }),
  ).toThrow()
})

test("compatibility uses the actual deployment and endpoint rather than a catalog alias or variant", () => {
  expect(
    SessionProviderContext.compatible(
      providerContext,
      SessionProviderContext.provenance({
        ...model,
        ref: { ...model.ref, id: Model.ID.make("alias"), variant: Model.VariantID.make("high") },
      }),
    ),
  ).toBe(true)
  for (const changed of [
    { ...model, model: LanguageModel.update(model.model, { id: "other-deployment" }) },
    {
      ...model,
      model: LanguageModel.update(model.model, {
        route: model.model.route.with({ endpoint: { baseURL: "https://another.example/v1?api-key=secret" } }),
      }),
    },
    { ...model, model: LanguageModel.update(model.model, { route: model.model.route.with({ id: "other-route" }) }) },
  ])
    expect(SessionProviderContext.compatible(providerContext, SessionProviderContext.provenance(changed))).toBe(false)
  const privateEndpoint = SessionProviderContext.provenance({
    ...model,
    model: LanguageModel.update(model.model, {
      route: model.model.route.with({ endpoint: { baseURL: "https://user:secret@example.com/v1?api-key=secret" } }),
    }),
  })
  expect(JSON.stringify(privateEndpoint)).not.toContain("secret")
  expect(
    SessionProviderContext.provenance({
      ...model,
      model: LanguageModel.update(model.model, {
        route: model.model.route.with({ endpoint: { path: () => "/dynamic" } }),
      }),
    }),
  ).toBeUndefined()
  expect(SessionProviderContext.compatible(providerContext, undefined)).toBe(false)
})

it.effect(
  "advances the native instruction epoch and omits superseded chronological updates after durable replay and provider switches",
  () =>
    Effect.gen(function* () {
      const s = yield* setup
      yield* s.prepare
      yield* s.prompt("original request")
      s.state.value = "changed instructions"
      yield* s.prepare
      yield* s.bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "manual", recent: "" })
      const completed = yield* s.compact(providerContext)
      s.state.value = "newest instructions"
      yield* s.prepare
      yield* s.prompt("continue")

      const verify = Effect.gen(function* () {
        expect(
          yield* s.db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).get(),
        ).toMatchObject({
          epoch_start: completed.durable.seq,
          initial_values: { "test/context": Instructions.hash("changed instructions") },
          current_values: { "test/context": Instructions.hash("newest instructions") },
        })
        const native = yield* s.load(target)
        expect(native.initial).toBe("changed instructions")
        expect(
          toLLMMessages(
            native.entries.map((entry) => entry.message),
            model.ref,
            "openai",
            target,
          ),
        ).toEqual([
          replacement[0],
          replacement[2],
          Message.system("newest instructions"),
          expect.objectContaining({ role: "user", content: [Message.text("continue")] }),
        ])
        for (const incompatible of [
          undefined,
          { ...providerContext.provenance, modelID: "other" },
          { ...providerContext.provenance, provider: "other" },
        ]) {
          const expanded = yield* s.load(incompatible)
          expect(expanded.initial).toBe("changed instructions")
          expect(
            toLLMMessages(
              expanded.entries.map((entry) => entry.message),
              model.ref,
            ).map((message) => message.content),
          ).toEqual([
            [Message.text("original request")],
            [Message.text("newest instructions")],
            [Message.text("continue")],
          ])
        }
        const preview = yield* SessionHistory.preview(s.db, sessionID, s.instructions, target)
        expect(preview.initial).toBe("changed instructions")
        expect(preview.messages).toEqual(native.entries.map((entry) => entry.message))
        const store = yield* SessionStore.Service
        expect((yield* store.messages({ sessionID })).map((message) => message.type)).toEqual([
          "user",
          "system",
          "compaction",
          "system",
          "user",
        ])
      })
      yield* verify
      const recorded = yield* s.db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
      expect(recorded.filter((event) => event.data.providerContext !== undefined)).toHaveLength(1)
      yield* s.bus.remove(sessionID)
      yield* s.db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
      for (const event of recorded)
        yield* s.bus.replay({
          id: event.id,
          created: event.created,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })
      yield* verify
    }),
)

it.effect("falls back to an earlier compatible native or local checkpoint", () =>
  Effect.gen(function* () {
    const s = yield* setup
    yield* s.prepare
    yield* s.prompt("before local")
    s.state.value = "local baseline"
    yield* s.prepare
    yield* s.compact()
    yield* s.prompt("after local")
    yield* s.compact(providerContext)
    yield* s.prompt("after native")
    s.state.value = "new native baseline"
    yield* s.prepare
    yield* s.compact({ ...providerContext, provenance: { ...providerContext.provenance, modelID: "other" } })
    s.state.value = "post-epoch update"
    yield* s.prepare
    const native = yield* s.load(target)
    expect(native.initial).toBe("new native baseline")
    expect(native.entries.map((entry) => entry.message.type)).toEqual(["compaction", "user", "system"])
    expect(native.entries[0]?.message).toMatchObject({ providerContext })
    expect(
      toLLMMessages(
        native.entries.map((entry) => entry.message),
        model.ref,
        "openai",
        target,
      ).filter((message) => message.role === "system"),
    ).toEqual([Message.system("post-epoch update")])
    const local = yield* s.load()
    expect(local.initial).toBe("new native baseline")
    expect(local.entries.map((entry) => entry.message.type)).toEqual(["compaction", "user", "user", "system"])
    expect(local.entries[0]?.message).toMatchObject({ summary: "local summary" })
  }),
)

it.effect("rejects malformed installed or persisted native windows instead of silently dropping them", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const malformed = { ...providerContext, messages: [{ role: "invalid", content: [] }] }
    expect(yield* s.compact(malformed).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
    yield* s.compact(providerContext)
    const row = yield* s.db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, sessionID))
      .get()
    if (!row) throw new Error("Expected projected checkpoint")
    const data = Schema.encodeSync(SessionMessage.CompactionCompleted)(
      Schema.decodeUnknownSync(SessionMessage.CompactionCompleted)({ ...row.data, id: row.id, type: row.type }),
    )
    yield* s.db
      .update(SessionMessageTable)
      .set({ data: { ...data, providerContext: malformed } })
      .where(eq(SessionMessageTable.id, row.id))
      .run()
    expect(yield* SessionHistory.load(s.db, sessionID, target).pipe(Effect.flip)).toMatchObject({
      _tag: "Session.MessageDecodeError",
    })
  }),
)
