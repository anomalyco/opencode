import { describe, expect } from "bun:test"
import path from "path"
import { DateTime, Effect, Layer, Stream } from "effect"
import { Money } from "@opencode-ai/schema/money"
import { AgentV2 } from "@opencode-ai/core/agent"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    list: () => Effect.succeed([]),
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const id = SessionV2.ID.create()

/** Public session events from a `log` read, without synced markers. */
const logEvents = (session: SessionV2.Interface, sessionID: SessionV2.ID, follow?: boolean) =>
  session
    .log({ sessionID, follow })
    .pipe(Stream.filter((item): item is SessionEvent.DurableEvent => !EventV2.isSynced(item)))

const assertCreateInputTypes = (session: SessionV2.Interface) => {
  // @ts-expect-error location or parentID is required.
  session.create({})
  // @ts-expect-error child sessions inherit their parent's location.
  session.create({ parentID: SessionV2.ID.create(), location })
}
void assertCreateInputTypes

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("SessionV2.create", () => {
  it.effect("creates a fresh projected session when the ID is omitted", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const first = yield* session.create({ location })
      const second = yield* session.create({ location })

      expect(second.id).not.toBe(first.id)
      expect((yield* session.list()).data).toHaveLength(2)
    }),
  )

  it.effect("returns the original session when the ID is retried", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const input = { id, location }

      const first = yield* session.create(input)
      const retried = yield* session.create(input)

      expect(retried).toEqual(first)
      expect((yield* session.list()).data).toEqual([first])
    }),
  )

  it.effect("stores supplied immutable create attributes", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const workspaceID = WorkspaceV2.ID.make("wrk_test")
      const model = ModelV2.Ref.make({
        id: ModelV2.ID.make("sonnet"),
        providerID: ProviderV2.ID.anthropic,
        variant: ModelV2.VariantID.make("fast"),
      })

      expect(
        yield* session.create({
          location: Location.Ref.make({ directory: location.directory, workspaceID }),
          agent: AgentV2.ID.make("build"),
          model,
        }),
      ).toMatchObject({ location: { directory: location.directory, workspaceID }, agent: "build", model })
    }),
  )

  it.effect("inherits location from an existing parent when omitted", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id, title: "child" })

      expect(child).toMatchObject({ parentID: parent.id, location })
    }),
  )

  it.effect("rejects child creation when the parent does not exist", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.create()

      expect(yield* Effect.flip(session.create({ parentID: missing, title: "child" }))).toEqual(
        new SessionV2.NotFoundError({ sessionID: missing }),
      )
    }),
  )

  it.effect("filters root sessions before applying the page limit", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
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

  it.effect("filters direct child sessions by parent ID", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ location, title: "parent" })
      const child = yield* session.create({ parentID: parent.id, title: "child" })
      yield* session.create({ location, title: "other root" })

      const page = yield* session.list({ parentID: parent.id })

      expect(page.data.map((item) => item.id)).toEqual([child.id])
    }),
  )

  it.effect("forks a session by replaying a durable fork event into copied projected rows", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location, title: "Parent" })
      const admitted = yield* session.prompt({
        sessionID: parent.id,
        text: "First",
        resume: false,
      })
      yield* SessionInput.promoteSteers(db, events, parent.id)
      yield* session.synthetic({ sessionID: parent.id, text: "parent note", resume: false })
      yield* SessionInput.promoteSteers(db, events, parent.id)

      const forked = yield* session.fork({ sessionID: parent.id })
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
      expect(yield* SessionInput.find(db, forkContext[0].id)).toMatchObject({
        sessionID: forked.id,
        type: "user",
        data: { text: "First" },
        promotedSeq: 2,
      })
      expect(yield* SessionInput.find(db, forkContext[1].id)).toMatchObject({
        sessionID: forked.id,
        type: "synthetic",
        data: { text: "parent note" },
      })

      yield* session.prompt({
        sessionID: parent.id,
        text: "Parent changed",
        resume: false,
      })
      yield* SessionInput.promoteSteers(db, events, parent.id)
      yield* session.prompt({
        sessionID: forked.id,
        text: "Child continues",
        resume: false,
      })
      yield* SessionInput.promoteSteers(db, events, forked.id)

      expect((yield* session.context(parent.id)).map((message) => message.type)).toEqual(["user", "synthetic", "user"])
      expect((yield* session.context(forked.id)).map((message) => message.type)).toEqual(["user", "synthetic", "user"])
      expect((yield* session.context(forked.id)).at(-1)).toMatchObject({ text: "Child continues" })
      expect(
        Array.from(yield* Stream.runCollect(logEvents(session, forked.id))).map(
          (event): number | undefined => event.durable?.seq,
        ),
      ).toEqual([0, 5, 6])
      expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({ sessionID: parent.id })
    }),
  )

  it.effect("forks before the selected boundary message", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      const first = yield* session.prompt({
        sessionID: parent.id,
        text: "First",
        resume: false,
      })
      yield* SessionInput.promoteSteers(db, events, parent.id)
      const second = yield* session.prompt({
        sessionID: parent.id,
        text: "Second",
        resume: false,
      })
      yield* SessionInput.promoteSteers(db, events, parent.id)
      const assistantMessageID = SessionMessage.ID.create()
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") })
      yield* events.publish(SessionEvent.Step.Started, {
        sessionID: parent.id,
        assistantMessageID,
        agent: AgentV2.ID.make("build"),
        model,
      })
      yield* events.publish(SessionEvent.Step.Ended, {
        sessionID: parent.id,
        assistantMessageID,
        finish: "stop",
        cost: Money.USD.make(0.75),
        tokens: { input: 6, output: 3, reasoning: 1, cache: { read: 2, write: 1 } },
      })

      const forked = yield* session.fork({ sessionID: parent.id, messageID: second.id })
      const beforeFirst = yield* session.fork({ sessionID: parent.id, messageID: first.id })
      const complete = yield* session.fork({ sessionID: parent.id })

      const context = yield* session.context(forked.id)
      const history = Array.from(yield* Stream.runCollect(logEvents(session, forked.id)))
      expect(forked.fork).toEqual({ sessionID: parent.id, messageID: second.id })
      expect(context).toMatchObject([{ text: "First" }])
      expect(context[0]?.id).not.toBe(first.id)
      expect(history[0]).toMatchObject({ data: { from: second.id } })
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
      const session = yield* SessionV2.Service
      const created = yield* session.create({ id, location })
      const changed = [
        { id, location: Location.Ref.make({ directory: AbsolutePath.make("/other") }) },
        { id, location, agent: AgentV2.ID.make("build") },
        {
          id,
          location,
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic }),
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
      const session = yield* SessionV2.Service
      const input = { id, location }

      const created = yield* Effect.all([session.create(input), session.create(input)], { concurrency: "unbounded" })

      expect(created[1]).toEqual(created[0])
      expect((yield* session.list()).data).toEqual([created[0]])
    }),
  )

  it.effect("returns the current Session projection after updates", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)

      expect(yield* session.create(input)).toMatchObject({ id: created.id, agent: "build" })
    }),
  )

  it.effect("returns the current Session projection after projected updates", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: id,
        info: SessionV1.SessionInfo.make({
          id,
          slug: "updated",
          version: "test",
          projectID: created.projectID,
          directory: created.location.directory,
          title: "updated",
          agent: "build",
          time: { created: 0, updated: 1 },
        }),
      })

      expect(yield* session.create(input)).toMatchObject({ id, agent: "build" })
    }),
  )

  it.effect("persists creation through the existing legacy created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toMatchObject([{ type: EventV2.versionedType(SessionV1.Event.Created.type, 1) }])
    }),
  )

  it.effect("persists caller-ID creation through the existing created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ id, location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).get().pipe(Effect.orDie),
      ).toMatchObject({
        data: { sessionID: id },
      })
    }),
  )

  it.effect("omits legacy creation rows from the V2 Session event stream", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })
      yield* session.prompt({
        sessionID: created.id,
        text: "Hello",
        resume: false,
      })
      yield* SessionInput.promoteSteers(db, events, created.id)

      expect(
        Array.from(yield* logEvents(session, created.id, true).pipe(Stream.take(2), Stream.runCollect)),
      ).toMatchObject([
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
      const session = yield* SessionV2.Service
      const sourceEvents = yield* EventV2.Service
      const sourceDb = (yield* Database.Service).db
      const created = yield* session.create({ id: SessionV2.ID.make("ses_fresh_target_replay"), location })
      const admitted = yield* session.prompt({
        sessionID: created.id,
        text: "Replay lifecycle",
        resume: false,
      })
      yield* SessionInput.promoteSteers(sourceDb, sourceEvents, created.id)
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
      const targetDatabase = Database.layerFromPath(path.join(tmp.path, "target.sqlite"))
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node]),
        [[Database.node, targetDatabase]],
      )

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const events = yield* EventV2.Service
        const store = yield* SessionStore.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: ProjectV2.ID.global, worktree: location.directory, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)

        expect(yield* store.get(created.id)).toBeUndefined()
        expect(yield* events.replayAll(serialized.slice(0, 2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          type: "user",
          data: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
        })
        expect(yield* store.context(created.id)).toEqual([])

        expect(yield* events.replayAll(serialized.slice(2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          type: "user",
          data: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
          promotedSeq: 2,
        })
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
          [0, EventV2.versionedType(SessionV1.Event.Created.type, 1)],
          [1, EventV2.versionedType(SessionEvent.InputAdmitted.type, 1)],
          [2, EventV2.versionedType(SessionEvent.InputPromoted.type, 1)],
        ])
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("does not mask unrelated created projector defects", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const event = yield* EventV2.Service
      const defect = new Error("unrelated projector defect")
      yield* event.project(SessionV1.Event.Created, () => Effect.die(defect))

      expect(yield* session.create({ id, location }).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    }),
  )

  it.live("runs a shell command and projects the started/ended shell message", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const session = yield* SessionV2.Service
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
        const session = yield* SessionV2.Service
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
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })

      yield* session.switchAgent({ sessionID: created.id, agent: AgentV2.ID.make("plan") })

      expect(yield* session.get(created.id)).toMatchObject({ agent: "plan" })
      expect(
        Array.from(yield* logEvents(session, created.id, true).pipe(Stream.take(1), Stream.runCollect)),
      ).toMatchObject([{ type: "session.agent.selected", data: { agent: "plan" } }])
    }),
  )

  it.effect("rejects an agent switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_agent_switch")

      expect(
        yield* session.switchAgent({ sessionID: missing, agent: AgentV2.ID.make("plan") }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("switches the selected model through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const model = ModelV2.Ref.make({
        id: ModelV2.ID.make("sonnet"),
        providerID: ProviderV2.ID.anthropic,
        variant: ModelV2.VariantID.make("high"),
      })

      yield* session.switchModel({ sessionID: created.id, model })

      expect(yield* session.get(created.id)).toMatchObject({ model })
      const events = Array.from(yield* logEvents(session, created.id, true).pipe(Stream.take(1), Stream.runCollect))
      expect(events).toMatchObject([{ type: "session.model.selected" }])
      expect(events[0]?.data).toEqual({ sessionID: created.id, model })
    }),
  )

  it.effect("ignores a model switch when the selected model is unchanged", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })

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
      const session = yield* SessionV2.Service
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })
      const created = yield* session.create({ location, model })

      yield* session.switchModel({
        sessionID: created.id,
        model: ModelV2.Ref.make({ ...model, variant: ModelV2.VariantID.make("default") }),
      })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(1)
    }),
  )

  it.effect("rejects a model switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_model_switch")

      expect(
        yield* session
          .switchModel({
            sessionID: missing,
            model: ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic }),
          })
          .pipe(
            Effect.flip,
            Effect.map((error) => error._tag),
          ),
      ).toBe("Session.NotFoundError")
    }),
  )
})
