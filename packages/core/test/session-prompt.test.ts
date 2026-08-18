import { describe, expect } from "bun:test"
import { DateTime, Effect, Fiber, Layer, LayerMap, Schema, Stream } from "effect"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { pathToFileURL } from "url"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { Agent } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionInboxTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Image } from "@opencode-ai/core/image"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { testEffect } from "./lib/effect"

const executionCalls: Session.ID[] = []
const interruptCalls: Session.ID[] = []
const interruptContinuations: Array<boolean | undefined> = []
const wakeCalls: Session.ID[] = []
const activeSessions = new Set<Session.ID>()
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(activeSessions)),
    resume: (sessionID) =>
      Effect.sync(() => {
        executionCalls.push(sessionID)
      }),
    interrupt: (sessionID, options) =>
      Effect.sync(() => {
        interruptCalls.push(sessionID)
        interruptContinuations.push(options?.continue)
      }),
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
    wakeActive: () => Effect.void,
    awaitIdle: () => Effect.void,
  }),
)
const locations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      // Attachment admission only needs image normalization and plugin readiness.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      Layer.unwrap(
        Effect.sync(() => {
          let ready = false
          return Layer.mergeAll(
            Layer.mock(Image.Service, {
              normalize: (_resource, content) =>
                ready
                  ? Effect.succeed(content.content.length > 5 * 1024 * 1024 ? { ...content, content: "AA==" } : content)
                  : Effect.die(new Error("Image service used before plugins were ready")),
            }),
            Layer.succeed(
              PluginSupervisor.Service,
              PluginSupervisor.Service.of({ flush: Effect.sync(() => (ready = true)) }),
            ),
          )
        }),
      ) as unknown as Layer.Layer<LocationServices>,
  ),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [SessionExecution.node, execution],
      [LocationServiceMap.node, locations],
    ],
  ),
)
const sessionID = Session.ID.make("ses_prompt_test")
const messageID = SessionMessage.ID.create()

const setup = Effect.gen(function* () {
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
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const admitted = (id: SessionMessage.ID) => Database.Service.use(({ db }) => SessionInbox.find(db, id))
const admittedCount = Database.Service.use(({ db }) =>
  db
    .select()
    .from(SessionInboxTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.length),
    ),
)
const eventCount = (type: string) =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(EventTable)
      .where(eq(EventTable.type, type))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.length),
      ),
  )

const encodeMessage = Schema.encodeSync(SessionMessage.Info)
const assistantRow = (id: SessionMessage.ID, seq: number) => {
  const {
    id: _,
    type,
    ...data
  } = encodeMessage(
    SessionMessage.Assistant.make({
      id,
      type: "assistant",
      agent: Agent.ID.make("build"),
      model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
      content: [],
      time: { created: DateTime.makeUnsafe(0) },
    }),
  )
  return { id, session_id: sessionID, type, seq, time_created: 0, data }
}

describe("Session.prompt", () => {
  it.effect("exposes the execution registry", () =>
    Effect.gen(function* () {
      activeSessions.add(sessionID)
      expect(Array.from(yield* (yield* Session.Service).active)).toEqual([sessionID])
    }).pipe(Effect.ensuring(Effect.sync(() => activeSessions.clear()))),
  )

  it.effect("delegates execution continuation through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("delegates process-local interruption through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      interruptCalls.length = 0
      wakeCalls.length = 0

      yield* session.interrupt(sessionID)
      expect(interruptCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
      expect(yield* session.messages({ sessionID })).toEqual([])
    }),
  )

  it.effect("forwards interrupt continuation policy", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      interruptCalls.length = 0
      interruptContinuations.length = 0
      wakeCalls.length = 0

      yield* session.interrupt(sessionID, { continue: true })

      expect(interruptCalls).toEqual([sessionID])
      expect(interruptContinuations).toEqual([true])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("delegates interruption without requiring a recorded Session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      interruptCalls.length = 0

      yield* session.interrupt(Session.ID.make("ses_missing"))
      expect(interruptCalls).toEqual([Session.ID.make("ses_missing")])
    }),
  )

  it.effect("durably admits one user message before transcript promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service

      const message = yield* session.prompt({
        sessionID,
        text: "Fix the failing tests",
        resume: false,
      })

      expect(message.payload.text).toBe("Fix the failing tests")
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).toMatchObject({
        id: message.id,
        sessionID,
        type: "user",
        payload: { text: "Fix the failing tests" },
        delivery: "steer",
      })
    }),
  )

  it.effect("commits a staged revert before admitting a new prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      const boundary = yield* session.prompt({
        sessionID,
        text: "boundary",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const stale = SessionMessage.ID.make("msg_stale_assistant")
      yield* db.insert(SessionMessageTable).values(assistantRow(stale, 100)).run().pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      expect((yield* session.get(sessionID)).revert?.messageID).toBe(boundary.id)

      yield* session.prompt({ sessionID, text: "after revert", resume: false })

      expect((yield* session.get(sessionID)).revert).toBeUndefined()
      expect(
        (yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).all().pipe(Effect.orDie)).map(
          (row) => row.id,
        ),
      ).not.toContainAnyValues([boundary.id, stale])
      expect(yield* SessionInbox.find(db, boundary.id)).toBeUndefined()
    }),
  )

  it.effect("holds synthetic input behind a staged revert and discards it when committed", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({
        sessionID,
        text: "boundary",
        resume: false,
      })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      wakeCalls.length = 0

      const completion = yield* session.synthetic({ sessionID, text: "stale completion" })

      expect(wakeCalls).toEqual([])
      expect(yield* SessionInbox.find(db, completion.id)).toMatchObject({ type: "synthetic" })

      yield* session.revert.commit(sessionID)

      expect(yield* SessionInbox.find(db, completion.id)).toBeUndefined()
    }),
  )

  it.effect("resolves attachment MIME before admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const uri =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this image",
        files: [{ uri, name: "image.png", mention: { start: 8, end: 17, text: "[Image 1]" } }],
        resume: false,
      })

      expect(message.payload.files).toEqual([
        {
          data: uri.slice(uri.indexOf(",") + 1),
          mime: "image/png",
          source: { type: "inline" },
          name: "image.png",
          mention: { start: 8, end: 17, text: "[Image 1]" },
        },
      ])
      const stored = yield* admitted(message.id)
      expect(stored?.type).toBe("user")
      if (stored?.type === "user") expect(stored.payload.files).toEqual(message.payload.files)
    }),
  )

  it.effect("materializes selected source file content", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const directory = import.meta.dir
      const source = path.join(directory, "session-prompt.test.ts")
      const sourceUri = pathToFileURL(source)
      sourceUri.searchParams.set("start", "1")
      sourceUri.searchParams.set("end", "1")

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this",
        files: [{ uri: sourceUri.href, name: "main.ts" }],
        resume: false,
      })

      expect(message.payload.files).toHaveLength(1)
      expect(message.payload.files?.[0]).toMatchObject({
        mime: "text/plain",
        source: { type: "uri", uri: sourceUri.href },
        name: "main.ts",
      })
      expect(
        Buffer.from(message.payload.files?.[0]?.data ?? "", "base64")
          .toString("utf8")
          .replace(/\r$/, ""),
      ).toBe('import { describe, expect } from "bun:test"')
    }),
  )

  it.effect("materializes directories as directory attachments", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const uri = pathToFileURL(import.meta.dir).href

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this",
        files: [{ uri, name: "source" }],
        resume: false,
      })

      expect(message.payload.files).toHaveLength(1)
      expect(message.payload.files?.[0]).toMatchObject({
        mime: "application/x-directory",
        source: { type: "uri", uri },
        name: "source",
      })
      expect(Buffer.from(message.payload.files?.[0]?.data ?? "", "base64").toString("utf8")).toContain(
        "session-prompt.test.ts",
      )
    }),
  )

  it.effect("materializes local image content before admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(path.join(tmpdir(), "opencode-session-prompt-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      )
      const source = path.join(directory, "image.png")
      const bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      )
      yield* Effect.promise(() => Bun.write(source, bytes))

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this image",
        files: [{ uri: pathToFileURL(source).href }],
        resume: false,
      })

      expect(message.payload.files).toEqual([
        {
          data: bytes.toString("base64"),
          mime: "image/png",
          source: { type: "uri", uri: pathToFileURL(source).href },
          name: "image.png",
        },
      ])
      const stored = yield* admitted(message.id)
      expect(stored?.type === "user" ? stored.payload.files : undefined).toEqual(message.payload.files)
    }),
  )

  it.effect("normalizes large image content before validating persisted Base64", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const pixel = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      )
      const bytes = Buffer.concat([pixel, Buffer.alloc(4_323_030 - pixel.length)])
      const data = bytes.toString("base64")
      expect(data).toHaveLength(5_764_040)

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this image",
        files: [{ uri: `data:image/png;base64,${data}` }],
        resume: false,
      })

      expect(message.payload.files).toEqual([
        {
          data: "AA==",
          mime: "image/png",
          source: { type: "inline" },
        },
      ])
    }),
  )

  it.effect("sniffs data URL content instead of trusting its declared MIME", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const uri = `data:video/mp2t;base64,${Buffer.from("export const value = 1\n").toString("base64")}`

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this",
        files: [{ uri, name: "main.ts" }],
        resume: false,
      })

      expect(message.payload.files).toEqual([
        {
          data: Buffer.from("export const value = 1\n").toString("base64"),
          mime: "text/plain",
          source: { type: "inline" },
          name: "main.ts",
        },
      ])
    }),
  )

  it.effect("rejects malformed base64 data URLs", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const uri = "data:image/png;base64,not-base64"

      const error = yield* session
        .prompt({
          sessionID,
          text: "Inspect this",
          files: [{ uri, name: "image.png" }],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(error).toMatchObject({
        _tag: "Session.AttachmentError",
        uri,
        message: "Invalid attachment data URL",
      })
    }),
  )

  it.effect("streams durable Session events after an aggregate sequence", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const publicEvents = (input: { sessionID: Session.ID; after?: number }) =>
        session
          .log({ ...input, follow: true })
          .pipe(Stream.filter((item): item is SessionEvent.DurableEvent => !Bus.isSynced(item)))
      const fiber = yield* publicEvents({ sessionID }).pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* session.prompt({ sessionID, text: "First", resume: false })
      yield* session.prompt({ sessionID, text: "Second", resume: false })
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      const streamed = Array.from(yield* Fiber.join(fiber))

      expect(streamed.map((event): [number | undefined, string] => [event.durable?.seq, event.type])).toEqual([
        [0, "session.inbox.enqueued"],
        [1, "session.inbox.enqueued"],
        [2, "session.inbox.delivered"],
        [3, "session.inbox.delivered"],
      ])
      expect(
        Array.from(
          yield* publicEvents({ sessionID, after: streamed[0].durable?.seq }).pipe(Stream.take(1), Stream.runCollect),
        ).map((event): [number | undefined, string] => [event.durable?.seq, event.type]),
      ).toEqual([[1, "session.inbox.enqueued"]])
    }),
  )

  it.effect("resumes through a recorded message without appending another prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const message = yield* session.prompt({
        sessionID,
        text: "Fix the failing tests",
        resume: false,
      })

      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)

      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).not.toHaveProperty("promotedSeq")
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("records distinct messages when the ID is omitted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = { sessionID, text: "Fix the failing tests", resume: false }

      const first = yield* session.prompt(input)
      const second = yield* session.prompt(input)

      expect(second.id).not.toBe(first.id)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(2)
    }),
  )

  it.effect("returns the original recorded message when the ID is retried", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = {
        sessionID,
        id: messageID,
        text: "Fix the failing tests",
        resume: false,
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)

      expect(retried).toEqual(first)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("reconciles an exact retry from the promoted message without admission history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const input = { sessionID, id: messageID, text: "Fix the failing tests", resume: false }
      const first = yield* session.prompt(input)
      yield* SessionInbox.promote(db, bus, sessionID, "steer")
      yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, sessionID)).run().pipe(Effect.orDie)

      const retried = yield* session.prompt(input)

      expect(retried).toMatchObject({ id: first.id, type: "user", payload: { text: first.payload.text } })
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: messageID, type: "user", text: "Fix the failing tests" },
      ])
    }),
  )

  it.effect("ignores delivery when retrying a promoted message", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const input = { sessionID, id: messageID, text: "Fix the failing tests", resume: false }
      yield* session.prompt(input)
      yield* SessionInbox.promote(db, bus, sessionID, "steer")

      const retried = yield* session.prompt({ ...input, delivery: "queue" })

      expect(retried).toMatchObject({ id: messageID, type: "user", payload: { text: input.text } })
      expect(yield* admitted(messageID)).toBeUndefined()
    }),
  )

  it.effect("wakes execution when an exact prompt retry recovers a committed message", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = {
        sessionID,
        id: messageID,
        text: "Recover committed prompt",
        resume: false,
      }
      const first = yield* session.prompt(input)
      wakeCalls.length = 0

      const retried = yield* session.prompt({ ...input, resume: true })

      expect(retried).toEqual(first)
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("rejects reuse of one ID with a different prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service

      yield* session.prompt({
        sessionID,
        id: messageID,
        text: "Fix the failing tests",
      })
      const failure = yield* session
        .prompt({
          sessionID,
          id: messageID,
          text: "Delete the failing tests",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
      expect(yield* session.messages({ sessionID })).toHaveLength(0)
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("rejects reuse of one ID with a different delivery mode", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service

      yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Fix the failing tests",
        resume: false,
      })
      const failure = yield* session
        .prompt({
          id: messageID,
          sessionID,
          text: "Fix the failing tests",
          delivery: "queue",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("returns one recorded message to concurrent exact retries", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = {
        sessionID,
        id: messageID,
        text: "Fix the failing tests",
        resume: false,
      }

      const messages = yield* Effect.all([session.prompt(input), session.prompt(input)], { concurrency: "unbounded" })

      expect(messages[1]).toEqual(messages[0])
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxEnqueued.type, 1))).toBe(1)
    }),
  )

  it.effect("promotes one message once under concurrent promotion attempts", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Promote once",
        resume: false,
      })

      yield* Effect.all(
        [SessionInbox.promote(db, bus, sessionID, "steer"), SessionInbox.promote(db, bus, sessionID, "steer")],
        { concurrency: "unbounded" },
      )

      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxDelivered.type, 1))).toBe(1)
      expect(yield* admitted(messageID)).toBeUndefined()
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: messageID, type: "user", text: "Promote once" },
      ])
    }),
  )

  it.effect("reprojects pending inbox input without scheduling execution", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      wakeCalls.length = 0
      yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Replay pending",
        resume: false,
      })
      const syntheticID = SessionMessage.ID.create()
      yield* session.synthetic({ id: syntheticID, sessionID, text: "Replay synthetic", resume: false })
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)

      yield* bus.remove(sessionID)
      yield* db.delete(SessionInboxTable).where(eq(SessionInboxTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
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

      expect(yield* admitted(messageID)).toMatchObject({
        id: messageID,
        type: "user",
        payload: { text: "Replay pending" },
      })
      expect(yield* admitted(syntheticID)).toMatchObject({
        id: syntheticID,
        type: "synthetic",
        payload: { text: "Replay synthetic" },
      })
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("rejects reuse of one globally unique message ID across sessions", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* Session.Service
      const other = Session.ID.make("ses_prompt_other")
      yield* db
        .insert(SessionTable)
        .values({
          id: other,
          project_id: Project.ID.global,
          slug: "other",
          directory: "/project",
          title: "other",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* session.prompt({ id: messageID, sessionID, text: "Fix the failing tests", resume: false })
      const failure = yield* session
        .prompt({ id: messageID, sessionID: other, text: "Fix the failing tests", resume: false })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID: other, messageID })
    }),
  )

  it.effect("rejects a prompt ID already used by visible Session history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const {
        id: _,
        type,
        ...data
      } = encodeMessage({
        id: messageID,
        type: "synthetic",
        text: "Existing history",
        time: { created: DateTime.makeUnsafe(0) },
      })
      yield* db
        .insert(SessionMessageTable)
        .values({ id: messageID, session_id: sessionID, type, seq: 0, time_created: 0, data })
        .run()
        .pipe(Effect.orDie)

      const failure = yield* session
        .prompt({
          id: messageID,
          sessionID,
          text: "Conflicting prompt",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID, messageID })
      expect(yield* admitted(messageID)).toBeUndefined()
    }),
  )

  it.effect("starts execution by default after recording the prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, text: "Run by default" })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("starts execution when resume is explicitly true", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({
        sessionID,
        text: "Run explicitly",
        resume: true,
      })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("only records the prompt when resume is false", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, text: "Do not run", resume: false })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("treats prompt metadata as durable retry identity", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const input = {
        id: messageID,
        sessionID,
        text: "Deploy",
        metadata: { source: "api" },
        resume: false,
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)
      const failure = yield* session.prompt({ ...input, metadata: { source: "plugin" } }).pipe(Effect.flip)

      expect(retried).toEqual(first)
      expect(first.payload.metadata).toEqual({ source: "api" })
      expect(failure._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("durably admits synthetic input before transcript promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      const input = yield* session.synthetic({
        id: messageID,
        sessionID,
        text: "Background work completed",
        description: "shell completion",
        metadata: { job: "shell" },
        resume: false,
      })

      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(input.id)).toMatchObject({
        type: "synthetic",
        sessionID,
        delivery: "steer",
        payload: {
          text: "Background work completed",
          description: "shell completion",
          metadata: { job: "shell" },
        },
      })

      yield* SessionInbox.promote(db, bus, sessionID, "steer")

      expect(yield* session.messages({ sessionID })).toMatchObject([
        {
          id: messageID,
          type: "synthetic",
          text: "Background work completed",
          description: "shell completion",
          metadata: { job: "shell" },
        },
      ])
    }),
  )

  it.effect("reconciles exact synthetic retries and rejects conflicting reuse", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const input = { id: messageID, sessionID, text: "Completed", resume: false }

      const entries = yield* Effect.all([session.synthetic(input), session.synthetic(input)], {
        concurrency: "unbounded",
      })
      yield* SessionInbox.promote(database.db, bus, sessionID, "steer")
      const promotedRetry = yield* session.synthetic(input)
      const failure = yield* session.synthetic({ ...input, text: "Different completion" }).pipe(Effect.flip)

      expect(entries[1]).toEqual(entries[0])
      expect(promotedRetry).toMatchObject({ id: messageID, type: "synthetic", payload: { text: "Completed" } })
      expect(failure).toMatchObject({ _tag: "Session.SyntheticConflictError", sessionID, inputID: messageID })
      expect(yield* admittedCount).toBe(0)
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxEnqueued.type, 1))).toBe(1)
    }),
  )

  it.effect("keeps queued input pending until the idle boundary", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      const input = yield* session.synthetic({
        sessionID,
        text: "Queued completion",
        delivery: "queue",
        resume: false,
      })

      expect(input.delivery).toBe("queue")
      expect(yield* SessionInbox.has(db, sessionID, "input")).toBe(true)
      expect(yield* SessionInbox.promote(db, bus, sessionID, "steer")).toBe(0)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* SessionInbox.promote(db, bus, sessionID, "input")).toBe(1)
      expect(yield* SessionInbox.has(db, sessionID, "input")).toBe(false)
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: input.id, type: "synthetic", text: "Queued completion" },
      ])
    }),
  )

  it.effect("promotes prompt and synthetic steers in admission order", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      yield* session.prompt({
        sessionID,
        text: "First prompt",
        resume: false,
      })
      yield* session.synthetic({ sessionID, text: "Background completion", resume: false })
      yield* session.prompt({
        sessionID,
        text: "Second prompt",
        resume: false,
      })

      yield* SessionInbox.promote(db, bus, sessionID, "steer")

      expect(
        (yield* session.messages({ sessionID, order: "asc" })).map((message) =>
          message.type === "user" || message.type === "synthetic" ? message.text : message.type,
        ),
      ).toEqual(["First prompt", "Background completion", "Second prompt"])
    }),
  )
})

describe("Session.inbox", () => {
  it.effect("fails for an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      expect(yield* session.inbox(Session.ID.make("ses_missing")).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.NotFoundError",
      })
    }),
  )

  it.effect("lists admitted work in admission order until promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service

      const first = yield* session.prompt({ sessionID, text: "First steer", resume: false })
      const queued = yield* session.synthetic({
        sessionID,
        text: "Queued completion",
        delivery: "queue",
        resume: false,
      })
      const second = yield* session.prompt({ sessionID, text: "Second steer", resume: false })

      expect(yield* session.inbox(sessionID)).toMatchObject([
        { id: first.id, type: "user", delivery: "steer" },
        { id: queued.id, type: "synthetic", delivery: "queue" },
        { id: second.id, type: "user", delivery: "steer" },
      ])

      expect(yield* SessionInbox.promote(db, bus, sessionID, "input")).toBe(2)
      expect(yield* session.inbox(sessionID)).toMatchObject([{ id: queued.id, type: "synthetic" }])

      expect(yield* SessionInbox.promote(db, bus, sessionID, "input")).toBe(1)
      expect(yield* session.inbox(sessionID)).toEqual([])
    }),
  )

  it.effect("lists an unhandled compaction until it is cancelled", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const { db } = yield* Database.Service

      const barrier = yield* session.compact({ sessionID })
      expect(yield* SessionInbox.has(db, sessionID, "any")).toBe(true)
      expect(yield* SessionInbox.has(db, sessionID, "input")).toBe(true)
      expect(yield* session.inbox(sessionID)).toMatchObject([{ id: barrier.id, type: "compaction" }])

      yield* session.cancelInbox({ sessionID, inboxID: barrier.id })
      expect(yield* SessionInbox.has(db, sessionID, "any")).toBe(false)
      expect(yield* session.inbox(sessionID)).toEqual([])
    }),
  )

  it.effect("cancels pending input and allows its ID to be admitted again", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const inputID = SessionMessage.ID.make("msg_cancelled_queue")
      yield* session.prompt({
        id: inputID,
        sessionID,
        text: "Queue this",
        delivery: "queue",
        resume: false,
      })

      yield* session.cancelInbox({ sessionID, inboxID: inputID })

      expect(yield* session.inbox(sessionID)).toEqual([])
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxCancelled.type, 1))).toBe(1)
      expect(yield* session.cancelInbox({ sessionID, inboxID: inputID }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.InboxConflictError",
        sessionID,
        inboxID: inputID,
      })
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxCancelled.type, 1))).toBe(1)

      const retried = yield* session.prompt({
        id: inputID,
        sessionID,
        text: "Queue this",
        delivery: "queue",
        resume: false,
      })
      expect(retried).toMatchObject({ id: inputID, delivery: "queue" })
    }),
  )

  it.effect("moves pending input between steer and queue delivery", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* Session.Service
      const queued = yield* session.synthetic({
        sessionID,
        text: "Steer this",
        delivery: "queue",
        resume: false,
      })
      const alreadySteered = yield* session.prompt({ sessionID, text: "Already steer", resume: false })
      wakeCalls.length = 0

      yield* session.steerInbox({ sessionID, inboxID: queued.id })

      expect(yield* session.inbox(sessionID)).toMatchObject([
        { id: queued.id, delivery: "steer" },
        { id: alreadySteered.id, delivery: "steer" },
      ])
      expect(wakeCalls).toEqual([sessionID])
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxDeliveryChanged.type, 1))).toBe(1)

      wakeCalls.length = 0
      yield* session.queueInbox({ sessionID, inboxID: queued.id })
      expect(yield* session.inbox(sessionID)).toMatchObject([
        { id: queued.id, delivery: "queue" },
        { id: alreadySteered.id, delivery: "steer" },
      ])
      expect(wakeCalls).toEqual([])
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxDeliveryChanged.type, 1))).toBe(2)

      expect(yield* session.steerInbox({ sessionID, inboxID: alreadySteered.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.InboxConflictError",
        sessionID,
        inboxID: alreadySteered.id,
      })
      yield* session.cancelInbox({ sessionID, inboxID: alreadySteered.id })
      expect(wakeCalls).toEqual([])
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxDeliveryChanged.type, 1))).toBe(2)
      expect(yield* eventCount(Bus.versionedType(SessionEvent.InboxCancelled.type, 1))).toBe(1)
    }),
  )
})
