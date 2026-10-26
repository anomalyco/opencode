import { expect, test } from "bun:test"
import { CompactionPart, LanguageModel, Message, ToolCallPart, Media } from "@opencode/ai/effect"
import { OpenAIResponses } from "@opencode/ai/protocols"
import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Instructions } from "@opencode/core/instructions/index"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionInbox } from "@opencode/core/session/inbox"
import { InstructionState } from "@opencode/core/session/instruction-state"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionLegacy } from "@opencode/schema/session-legacy"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { SessionSchema } from "@opencode/core/session/schema"
import { InstructionStateTable, SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { asc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { testEffect } from "./lib/effect"
import legacyMedia from "./fixture/native/2.0.14-media.json"

// A window as compaction stores it, and as history and replay read it back.
const stored = (messages: ReadonlyArray<Message>) => ({ messages: JSON.parse(JSON.stringify(messages)) })
const decode = (checkpoint: { readonly native: { readonly messages: unknown } }) =>
  Schema.decodeUnknownSync(SessionHistory.NativeWindow)(checkpoint.native.messages)

const model = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "deployment", provider: "openai", route: OpenAIResponses.route }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [],
    limit: { context: 128_000, output: 4096 },
  },
)
const target = model.ref
const replacement = [
  Message.user("retained request"),
  Message.assistant(
    CompactionPart.make({ provider: model.model.provider, encrypted: "opaque-checkpoint", id: "cp_1" }),
  ),
]
const native = stored(replacement)
const sessionID = SessionSchema.ID.make("ses_native")

// A window as releases before v2.1 stored it, read the way history reads stored rows.
const legacy = (messages: unknown) =>
  SessionLegacy.message("compaction", { providerContext: { version: 1, messages } }) as {
    readonly native: { readonly messages: unknown }
  }
// Frozen serialized data, deliberately not constructed using today's Message API.
const legacyCheckpoint = legacy(legacyMedia)

test("reads pre-2.0.15 checkpoint media without rewriting the stored payload", async () => {
  const before = JSON.stringify(legacyMedia)
  const decoded = decode(legacyCheckpoint)
  expect(await Effect.runPromise(validate(legacyCheckpoint))).toEqual(decoded)
  expect(decoded[0]?.content).toMatchObject([
    { type: "text", text: "retained attachments" },
    {
      type: "media",
      media: { source: { type: "base64", data: "AQID", mediaType: "image/png" } },
      filename: "attachment.png",
      cache: { type: "ephemeral" },
      metadata: { attachment: "original" },
      providerMetadata: { openai: { detail: "high" } },
    },
    { type: "media", media: { source: { type: "base64", data: "BAUG", mediaType: "image/jpeg" } } },
  ])
  expect(decoded[1]?.content).toMatchObject(legacyMedia[1]?.content ?? [])
  expect(JSON.stringify(legacyMedia)).toBe(before)
})

test("reads mixed legacy and current media without overriding an existing asset", async () => {
  const current = {
    type: "media",
    media: { source: { type: "base64", data: "BAUG", mediaType: "image/jpeg" } },
    mediaType: "image/png",
    data: "AQID",
  }
  const checkpoint = legacy([{ role: "user", content: [...(legacyMedia[0]?.content ?? []), current] }])
  const decoded = decode(checkpoint)
  expect(await Effect.runPromise(validate(checkpoint))).toEqual(decoded)
  expect(decoded[0]?.content.at(-1)).toMatchObject({ media: current.media })
  const invalid = legacy([{ role: "user", content: [{ ...current, media: null }] }])
  expect(() => decode(invalid)).toThrow()
  expect(await Effect.runPromise(Effect.isFailure(validate(invalid)))).toBe(true)
})

const validate = (checkpoint: { readonly native: { readonly messages: unknown } }) =>
  Schema.decodeUnknownEffect(SessionHistory.NativeWindow)(checkpoint.native.messages)

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
    slug: "native",
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
  const compact = (window?: SessionMessage.Native, ref = model.ref) =>
    bus.publish(SessionEvent.Compaction.Ended, {
      sessionID,
      reason: "manual",
      model: ref,
      text: window ? "" : "local summary",
      native: window,
    })
  const load = (boundary: SessionHistory.Boundary) =>
    SessionHistory.entriesForRunner(database.db, sessionID, instructions, boundary)
  return { db: database.db, bus, state, instructions, prepare, prompt, compact, load }
})

it.effect("loads and replays a pre-v2.1 providerContext checkpoint with pre-2.0.15 media", () =>
  Effect.gen(function* () {
    const s = yield* setup
    yield* s.prepare
    yield* s.prompt("original request")
    yield* s.bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "manual" })
    // An event as releases before v2.1 stored it.
    yield* s.bus.replay({
      id: Event.ID.create(),
      created: 1,
      aggregateID: sessionID,
      seq: (yield* Bus.latestSequence(s.db, sessionID)) + 1,
      type: Bus.versionedType(SessionEvent.Compaction.Ended.type, 1),
      data: {
        sessionID,
        reason: "manual",
        model: model.ref,
        text: "",
        providerContext: { version: 1, provenance: { providerID: "openai" }, messages: legacyMedia },
      },
    })
    // Its projected row, too: the event upgrades before projecting, so restore the old row shape directly.
    const providerContext = JSON.stringify({ version: 1, provenance: { providerID: "openai" }, messages: legacyMedia })
    yield* s.db
      .update(SessionMessageTable)
      .set({
        data: sql`json_set(json_remove(${SessionMessageTable.data}, '$.native'), '$.providerContext', json(${providerContext}))`,
      })
      .where(eq(SessionMessageTable.type, "compaction"))
      .run()
    expect(
      (yield* s.db.select().from(SessionMessageTable).where(eq(SessionMessageTable.type, "compaction")).get())?.data,
    ).not.toHaveProperty("native")
    yield* s.prompt("continue")
    const history = yield* SessionHistory.load(s.db, sessionID, target)
    expect(toLLMMessages(history, model.ref).slice(0, 2)).toEqual([...decode(legacyCheckpoint)])
    expect(history.some(SessionHistory.isNativeCompaction)).toBe(true)
    const local = yield* SessionHistory.load(s.db, sessionID, "local")
    expect(local.some(SessionHistory.isNativeCompaction)).toBe(false)
    expect(toLLMMessages(local, model.ref).map((message) => message.content)).toEqual([
      [Message.text("original request")],
      [Message.text("continue")],
    ])
  }),
)

test("a native window round-trips tools, opaque checkpoints and binary media through JSON", () => {
  const messages = [
    ...replacement,
    Message.assistant(ToolCallPart.make({ id: "call_1", name: "read", input: { path: "file" } })),
    Message.tool({ id: "call_1", name: "read", result: { text: "result" } }),
    Message.user({ type: "media", media: Media.bytes(new Uint8Array([1, 2, 3]), "image/png") }),
  ]
  expect(decode({ native: stored(messages) })).toEqual(messages)
  const optionalMetadata = stored([
    Message.make({
      role: "user",
      content: [
        { type: "text", text: "attachment", metadata: { attachment: { name: undefined, source: { type: "inline" } } } },
      ],
      providerMetadata: { openai: { itemId: undefined, type: "message", status: undefined, phase: undefined } },
    }),
  ])
  expect(decode({ native: optionalMetadata })[0]).toMatchObject({
    providerMetadata: { openai: { type: "message" } },
    content: [{ metadata: { attachment: { source: { type: "inline" } } } }],
  })
  expect(() =>
    decode({
      native: { messages: [{ role: "assistant", content: [{ type: "compaction", provider: "openai" }] }] },
    }),
  ).toThrow()
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
      yield* s.bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "manual" })
      const completed = yield* s.compact(native)
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
        const replayed = yield* s.load(target)
        expect(replayed.initial).toBe("changed instructions")
        expect(
          toLLMMessages(
            replayed.entries.map((entry) => entry.message),
            model.ref,
          ),
        ).toEqual([
          ...replacement,
          Message.system("newest instructions"),
          expect.objectContaining({ role: "user", content: [Message.text("continue")] }),
        ])
        for (const incompatible of [
          "local" as const,
          { ...model.ref, id: Model.ID.make("other") },
          { ...model.ref, providerID: Provider.ID.make("other") },
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
        expect(preview.messages).toEqual(replayed.entries.map((entry) => entry.message))
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
      expect(recorded.filter((event) => event.data.native !== undefined)).toHaveLength(1)
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
    yield* s.compact(native)
    yield* s.prompt("after native")
    s.state.value = "new native baseline"
    yield* s.prepare
    yield* s.compact(native, { ...model.ref, id: Model.ID.make("other") })
    s.state.value = "post-epoch update"
    yield* s.prepare
    const replayed = yield* s.load(target)
    expect(replayed.initial).toBe("new native baseline")
    expect(replayed.entries.map((entry) => entry.message.type)).toEqual(["compaction", "user", "system"])
    expect(replayed.entries[0]?.message).toMatchObject({ native, model: model.ref })
    expect(
      toLLMMessages(
        replayed.entries.map((entry) => entry.message),
        model.ref,
      ).filter((message) => message.role === "system"),
    ).toEqual([Message.system("post-epoch update")])
    const local = yield* s.load("local")
    expect(local.initial).toBe("new native baseline")
    expect(local.entries.map((entry) => entry.message.type)).toEqual(["compaction", "user", "user", "system"])
    expect(local.entries[0]?.message).toMatchObject({ summary: "local summary" })
  }),
)

it.effect("skips a malformed native window and replays the history before it", () =>
  Effect.gen(function* () {
    const s = yield* setup
    yield* s.prompt("before")
    yield* s.compact({ messages: [{ role: "invalid", content: [] }] })
    yield* s.prompt("after")
    const history = yield* SessionHistory.load(s.db, sessionID, target)
    expect(toLLMMessages(history, model.ref).map((message) => message.content)).toEqual([
      [Message.text("before")],
      [Message.text("after")],
    ])
    const store = yield* SessionStore.Service
    expect((yield* store.context(sessionID)).map((message) => message.type)).toEqual(["compaction", "user"])
  }),
)
