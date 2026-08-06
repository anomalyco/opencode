import { describe, expect } from "bun:test"
import path from "path"
import { DateTime, Effect, Layer, Stream } from "effect"
import { Money } from "@opencode-ai/schema/money"
import { Agent } from "@opencode-ai/core/agent"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionPending } from "@opencode-ai/core/session/pending"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Workspace } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const projects = Layer.succeed(
  Project.Service,
  Project.Service.of({
    list: () => Effect.succeed([]),
    resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
    directories: () => Effect.succeed([]),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [Project.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const id = Session.ID.create()

/** Public session events from a `log` read, without synced markers. */
const logEvents = (session: Session.Interface, sessionID: Session.ID, follow?: boolean) =>
  session
    .log({ sessionID, follow })
    .pipe(Stream.filter((item): item is SessionEvent.DurableEvent => !Bus.isSynced(item)))

const assertCreateInputTypes = (session: Session.Interface) => {
  // @ts-expect-error location or parentID is required.
  session.create({})
  // @ts-expect-error child sessions inherit their parent's location.
  session.create({ parentID: Session.ID.create(), location })
}
void assertCreateInputTypes

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("Session.create", () => {
  it.effect("persists a missing title until one is generated or supplied", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service

      const created = yield* session.create({ location })
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, created.id)).get().pipe(Effect.orDie)
      const event = yield* db
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .get()
        .pipe(Effect.orDie)

      expect(created.title).toBeUndefined()
      expect(row?.title).toBeNull()
      expect(event?.data).not.toHaveProperty("title")
      expect((yield* session.create({ location, title: "Explicit title" })).title).toBe("Explicit title")
    }),
  )

  it.effect("creates a fresh projected session when the ID is omitted", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service

      const first = yield* session.create({ location })
      const second = yield* session.create({ location })

      expect(second.id).not.toBe(first.id)
      expect((yield* session.list()).data).toHaveLength(2)
    }),
  )

  it.effect("returns the original session when the ID is retried", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const input = { id, location }

      const first = yield* session.create(input)
      const retried = yield* session.create(input)

      expect(retried).toEqual(first)
      expect((yield* session.list()).data).toEqual([first])
    }),
  )

  it.effect("stores supplied immutable create attributes", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const workspaceID = Workspace.ID.make("wrk_test")
      const model = Model.Ref.make({
        id: Model.ID.make("sonnet"),
        providerID: Provider.ID.anthropic,
        variant: Model.VariantID.make("fast"),
      })

      expect(
        yield* session.create({
          location: Location.Ref.make({ directory: location.directory, workspaceID }),
          agent: Agent.ID.make("build"),
          model,
        }),
      ).toMatchObject({ location: { directory: location.directory, workspaceID }, agent: "build", model })
    }),
  )

  it.effect("inherits location from an existing parent when omitted", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id, title: "child" })

      expect(child).toMatchObject({ parentID: parent.id, location })
    }),
  )

  it.effect("rejects child creation when the parent does not exist", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = Session.ID.create()

      expect(yield* Effect.flip(session.create({ parentID: missing, title: "child" }))).toEqual(
        new Session.NotFoundError({ sessionID: missing }),
      )
    }),
  )

  it.effect("filters root sessions before applying the page limit", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const staleRoot = yield* session.create({ location, title: "stale root" })
      const root = yield* session.create({ location, title: "root" })
      const children = yield* Effect.forEach(Array.from({ length: 60 }), (_, index) =>
        session.create({ parentID: root.id, title: `child ${index}` }),
      )

      yield* Effect.forEach(children, (item, index) =>
        db
          .update(SessionTable)
          .set({ time_created: index + 100, time_updated: index + 20_000 })
          .where(eq(SessionTable.id, item.id))
          .run(),
      )
      yield* db
        .update(SessionTable)
        .set({ time_created: 2, time_updated: 5_000 })
        .where(eq(SessionTable.id, staleRoot.id))
        .run()
      yield* db
        .update(SessionTable)
        .set({ time_created: 1, time_updated: 10_000 })
        .where(eq(SessionTable.id, root.id))
        .run()

      const page = yield* session.list({ directory: location.directory, parentID: null, limit: 1, order: "desc" })

      expect(page.data.map((item) => item.id)).toEqual([root.id])
    }),
  )

  it.effect("orders sessions by their latest prompt", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const active = yield* session.create({ location, title: "active" })
      const newer = yield* session.create({ location, title: "newer" })

      yield* db
        .update(SessionTable)
        .set({ time_created: -2, time_updated: -2 })
        .where(eq(SessionTable.id, active.id))
        .run()
      yield* db
        .update(SessionTable)
        .set({ time_created: -1, time_updated: -1 })
        .where(eq(SessionTable.id, newer.id))
        .run()

      yield* session.prompt({ sessionID: active.id, text: "continue", resume: false })

      expect((yield* session.list()).data.map((item) => item.id)).toEqual([active.id, newer.id])
    }),
  )

  it.effect("filters direct child sessions by parent ID", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const parent = yield* session.create({ location, title: "parent" })
      const child = yield* session.create({ parentID: parent.id, title: "child" })
      yield* session.create({ location, title: "other root" })

      const page = yield* session.list({ parentID: parent.id })

      expect(page.data.map((item) => item.id)).toEqual([child.id])
    }),
  )

  it.effect("filters project sessions by subpath", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const root = yield* session.create({ location, title: "root" })
      const nested = yield* session.create({ location, title: "nested" })

      yield* db.update(SessionTable).set({ path: "packages/tui" }).where(eq(SessionTable.id, nested.id)).run()

      const page = yield* session.list({
        project: Project.ID.global,
        subpath: RelativePath.make("packages/tui"),
        parentID: null,
      })

      expect(page.data.map((item) => item.id)).toEqual([nested.id])
      expect(page.data.map((item) => item.id)).not.toContain(root.id)
    }),
  )

  it.effect("forks a session by replaying a durable fork event into copied projected rows", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location, title: "Parent" })
      const admitted = yield* session.prompt({
        sessionID: parent.id,
        text: "First",
        resume: false,
      })
      yield* SessionPending.promote(db, bus, parent.id, "steer")
      yield* session.synthetic({ sessionID: parent.id, text: "parent note", resume: false })
      yield* SessionPending.promote(db, bus, parent.id, "steer")

      const forked = yield* session.fork({ sessionID: parent.id, boundary: { type: "through" } })
      const parentContext = yield* session.context(parent.id)
      const forkContext = yield* session.context(forked.id)
      const history = Array.from(yield* Stream.runCollect(logEvents(session, forked.id)))

      expect(forked).toMatchObject({ title: "Parent (fork #1)", fork: { sessionID: parent.id } })
      expect(forked.parentID).toBeUndefined()
      expect(forkContext).toMatchObject([
        { type: "user", text: "First" },
        { type: "synthetic", text: "parent note" },
      ])
      expect(forkContext.map((message) => message.id)).not.toEqual(parentContext.map((message) => message.id))
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        type: "session.forked",
        durable: { seq: 0 },
        data: { sessionID: forked.id, parentID: parent.id },
      })
      expect(yield* SessionPending.find(db, forkContext[0].id)).toBeUndefined()
      expect(yield* SessionPending.find(db, forkContext[1].id)).toBeUndefined()
      expect(
        yield* session.prompt({ id: forkContext[0].id, sessionID: forked.id, text: "First", resume: false }),
      ).toMatchObject({ id: forkContext[0].id, type: "user", data: { text: "First" } })

      yield* session.prompt({
        sessionID: parent.id,
        text: "Parent changed",
        resume: false,
      })
      yield* SessionPending.promote(db, bus, parent.id, "steer")
      yield* session.prompt({
        sessionID: forked.id,
        text: "Child continues",
        resume: false,
      })
      yield* SessionPending.promote(db, bus, forked.id, "steer")

      expect((yield* session.context(parent.id)).map((message) => message.type)).toEqual(["user", "synthetic", "user"])
      expect((yield* session.context(forked.id)).map((message) => message.type)).toEqual(["user", "synthetic", "user"])
      expect((yield* session.context(forked.id)).at(-1)).toMatchObject({ text: "Child continues" })
      expect(
        Array.from(yield* Stream.runCollect(logEvents(session, forked.id))).map(
          (event): number | undefined => event.durable?.seq,
        ),
      ).toEqual([0, 5, 6])
      expect(yield* SessionPending.find(db, admitted.id)).toBeUndefined()
    }),
  )

  it.effect("keeps a fork untitled when its parent is untitled", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      yield* session.prompt({ sessionID: parent.id, text: "First", resume: false })
      yield* SessionPending.promote(db, bus, parent.id, "steer")

      const forked = yield* session.fork({ sessionID: parent.id, boundary: { type: "through" } })
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, forked.id)).get().pipe(Effect.orDie)

      expect(forked.title).toBeUndefined()
      expect(row?.title).toBeNull()
    }),
  )

  it.effect("rejects forking an empty session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const parent = yield* session.create({ location })

      expect(
        yield* session.fork({ sessionID: parent.id, boundary: { type: "through" } }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.ForkEmptyError", sessionID: parent.id })
    }),
  )

  it.effect("forks before the selected boundary message", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      const first = yield* session.prompt({
        sessionID: parent.id,
        text: "First",
        resume: false,
      })
      yield* SessionPending.promote(db, bus, parent.id, "steer")
      const second = yield* session.prompt({
        sessionID: parent.id,
        text: "Second",
        resume: false,
      })
      yield* SessionPending.promote(db, bus, parent.id, "steer")
      const assistantMessageID = SessionMessage.ID.create()
      const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: parent.id,
        assistantMessageID,
        agent: Agent.ID.make("build"),
        model,
      })
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID: parent.id,
        assistantMessageID,
        finish: "stop",
        cost: Money.USD.make(0.75),
        tokens: { input: 6, output: 3, reasoning: 1, cache: { read: 2, write: 1 } },
      })

      const forked = yield* session.fork({
        sessionID: parent.id,
        boundary: { type: "before", messageID: second.id },
      })
      const beforeFirst = yield* session.fork({
        sessionID: parent.id,
        boundary: { type: "before", messageID: first.id },
      })
      const complete = yield* session.fork({ sessionID: parent.id, boundary: { type: "through" } })

      const context = yield* session.context(forked.id)
      const history = Array.from(yield* Stream.runCollect(logEvents(session, forked.id)))
      expect(forked.fork).toEqual({
        sessionID: parent.id,
        boundary: { type: "before", messageID: second.id },
      })
      expect(context).toMatchObject([{ text: "First" }])
      expect(context[0]?.id).not.toBe(first.id)
      expect(history[0]).toMatchObject({
        data: { boundary: { type: "before", messageID: second.id } },
      })
      expect(forked).toMatchObject({ cost: 0, tokens: { input: 0, output: 0, reasoning: 0 } })
      expect(yield* session.context(beforeFirst.id)).toEqual([])
      expect(beforeFirst).toMatchObject({ cost: 0, tokens: { input: 0, output: 0, reasoning: 0 } })
      expect(complete).toMatchObject({
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
    }),
  )

  it.effect("returns the existing Session when one ID is reused with different create arguments", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ id, location })
      const changed = [
        { id, location: Location.Ref.make({ directory: AbsolutePath.make("/other") }) },
        { id, location, agent: Agent.ID.make("build") },
        {
          id,
          location,
          model: Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic }),
        },
      ]

      for (const input of changed) {
        expect(yield* session.create(input)).toEqual(created)
      }
      expect((yield* session.list()).data).toHaveLength(1)
    }),
  )

  it.effect("returns one recorded session to concurrent exact retries", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const input = { id, location }

      const created = yield* Effect.all([session.create(input), session.create(input)], { concurrency: "unbounded" })

      expect(created[1]).toEqual(created[0])
      expect((yield* session.list()).data).toEqual([created[0]])
    }),
  )

  it.effect("returns the current Session projection after updates", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)

      expect(yield* session.create(input)).toMatchObject({ id: created.id, agent: "build" })
    }),
  )

  it.effect("persists creation through the current created event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toMatchObject([{ type: Bus.versionedType(SessionEvent.Created.type, 1) }])
    }),
  )

  it.effect("persists caller-ID creation through the existing created event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ id, location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).get().pipe(Effect.orDie),
      ).toMatchObject({
        data: { sessionID: id },
      })
    }),
  )

  it.effect("includes current creation rows in the Session event stream", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })
      yield* session.prompt({
        sessionID: created.id,
        text: "Hello",
        resume: false,
      })
      yield* SessionPending.promote(db, bus, created.id, "steer")

      expect(
        Array.from(yield* logEvents(session, created.id, true).pipe(Stream.take(3), Stream.runCollect)),
      ).toMatchObject([
        { durable: { seq: 0 }, type: "session.created" },
        {
          durable: { seq: 1 },
          type: "session.input.admitted",
          data: { input: { type: "user", data: { text: "Hello" }, delivery: "steer" } },
        },
        { durable: { seq: 2 }, type: "session.input.promoted" },
      ])
    }),
  )

  it.effect("replays one prompt lifecycle into a fresh target database", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sourceEvents = yield* Bus.Service
      const sourceDb = (yield* Database.Service).db
      const created = yield* session.create({ id: Session.ID.make("ses_fresh_target_replay"), location })
      const admitted = yield* session.prompt({
        sessionID: created.id,
        text: "Replay lifecycle",
        resume: false,
      })
      yield* SessionPending.promote(sourceDb, sourceEvents, created.id, "steer")
      const serialized = (yield* sourceDb
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)).map((event) => ({
        id: event.id,
        created: DateTime.makeUnsafe(event.created),
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      }))

      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const targetDatabase = Database.layer({ path: path.join(tmp.path, "target.sqlite") })
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node]),
        [
          [Database.node, targetDatabase],
          [Bus.node, Bus.configured({ persist: true })],
        ],
      )

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const bus = yield* Bus.Service
        const store = yield* SessionStore.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)

        expect(yield* store.get(created.id)).toBeUndefined()
        expect(yield* bus.replayAll(serialized.slice(0, 2))).toBe(created.id)
        expect(yield* SessionPending.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          type: "user",
          data: { text: "Replay lifecycle" },
          delivery: "steer",
        })
        expect(yield* store.context(created.id)).toEqual([])

        expect(yield* bus.replayAll(serialized.slice(2))).toBe(created.id)
        expect(yield* SessionPending.find(db, admitted.id)).toBeUndefined()
        expect(yield* store.context(created.id)).toMatchObject([
          { id: admitted.id, type: "user", text: "Replay lifecycle" },
        ])
        expect(
          (yield* db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, created.id))
            .orderBy(asc(EventTable.seq))
            .all()
            .pipe(Effect.orDie)).map((event) => [event.seq, event.type]),
        ).toEqual([
          [0, Bus.versionedType(SessionEvent.Created.type, 1)],
          [1, Bus.versionedType(SessionEvent.InputAdmitted.type, 1)],
          [2, Bus.versionedType(SessionEvent.InputPromoted.type, 1)],
        ])
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("does not mask unrelated created projector defects", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const event = yield* Bus.Service
      const defect = new Error("unrelated projector defect")
      yield* event.project(SessionEvent.Created, () => Effect.die(defect))

      expect(yield* session.create({ id, location }).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    }),
  )

  it.live("runs a shell command and projects the started/ended shell message", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const created = yield* session.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
        })

        yield* session.shell({ sessionID: created.id, command: "echo hello" })

        const messages = yield* session.messages({ sessionID: created.id, order: "asc" })
        const shell = messages.find((message): message is SessionMessage.Shell => message.type === "shell")
        expect(shell).toMatchObject({ type: "shell", command: "echo hello", status: "exited", exit: 0 })
        expect(shell?.output?.output).toContain("hello")
        expect(shell?.output?.truncated).toBe(false)
        expect(shell?.time.completed).toBeDefined()
      }),
    ),
  )

  it.live("still emits shell ended for a failing command", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const created = yield* session.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
        })

        yield* session.shell({ sessionID: created.id, command: "false" })

        const messages = yield* session.messages({ sessionID: created.id, order: "asc" })
        const shell = messages.find((message): message is SessionMessage.Shell => message.type === "shell")
        expect(shell).toMatchObject({ type: "shell", command: "false", status: "exited" })
        expect(shell?.exit).not.toBe(0)
        expect(shell?.time.completed).toBeDefined()
      }),
    ),
  )

  it.effect("switches the selected agent through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })

      yield* session.switchAgent({ sessionID: created.id, agent: Agent.ID.make("plan") })

      expect(yield* session.get(created.id)).toMatchObject({ agent: "plan" })
      expect(
        Array.from(yield* logEvents(session, created.id, true).pipe(Stream.drop(1), Stream.take(1), Stream.runCollect)),
      ).toMatchObject([{ type: "session.agent.selected", data: { agent: "plan" } }])
    }),
  )

  it.effect("rejects an agent switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = Session.ID.make("ses_missing_agent_switch")

      expect(
        yield* session.switchAgent({ sessionID: missing, agent: Agent.ID.make("plan") }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("switches the selected model through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      const model = Model.Ref.make({
        id: Model.ID.make("sonnet"),
        providerID: Provider.ID.anthropic,
        variant: Model.VariantID.make("high"),
      })

      yield* session.switchModel({ sessionID: created.id, model })

      expect(yield* session.get(created.id)).toMatchObject({ model })
      const bus = Array.from(
        yield* logEvents(session, created.id, true).pipe(Stream.drop(1), Stream.take(1), Stream.runCollect),
      )
      expect(bus).toMatchObject([{ type: "session.model.selected" }])
      expect(bus[0]?.data).toEqual({ sessionID: created.id, model })
    }),
  )

  it.effect("ignores a model switch when the selected model is unchanged", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      const model = Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic })

      yield* session.switchModel({ sessionID: created.id, model })
      yield* session.switchModel({ sessionID: created.id, model })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(2)
      expect(yield* session.get(created.id)).toMatchObject({ model })
    }),
  )

  it.effect("treats an omitted variant as the default variant", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const model = Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic })
      const created = yield* session.create({ location, model })

      yield* session.switchModel({
        sessionID: created.id,
        model: Model.Ref.make({ ...model, variant: Model.VariantID.make("default") }),
      })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(1)
    }),
  )

  it.effect("rejects a model switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = Session.ID.make("ses_missing_model_switch")

      expect(
        yield* session
          .switchModel({
            sessionID: missing,
            model: Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.anthropic }),
          })
          .pipe(
            Effect.flip,
            Effect.map((error) => error._tag),
          ),
      ).toBe("Session.NotFoundError")
    }),
  )
})
