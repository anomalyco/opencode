import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit, Layer, Schema, Scope, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { Agent } from "@opencode-ai/schema/agent"
import { Model } from "@opencode-ai/schema/model"
import { Money } from "@opencode-ai/schema/money"
import { Provider } from "@opencode-ai/schema/provider"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { Bus } from "../src/bus.js"
import { Database } from "../src/database/database.js"
import { EventTable } from "../src/event/sql.js"
import { Location } from "../src/location.js"
import { PluginSupervisor } from "../src/plugin/supervisor-service.js"
import { AbsolutePath, RelativePath } from "../src/schema.js"
import { SessionEvent } from "../src/session/event.js"
import { SessionMessage } from "../src/session/message.js"
import { SessionProjector } from "../src/session/projector.js"
import { SessionRevert } from "../src/session/revert.js"
import { SessionSchema } from "../src/session/schema.js"
import { SessionStore } from "../src/session/store.js"
import { SessionTable } from "../src/session/sql.js"
import { Snapshot } from "../src/snapshot.js"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
// Root and Windows do not enforce this fixture's POSIX directory permissions.
const permissionTest = process.platform === "win32" || process.getuid?.() === 0 ? it.live.skip : it.live
const sessionID = SessionSchema.ID.make("ses_revert_recovery")
const edited = {
  "first.txt": "edited:first\n",
  "blocked/file.txt": "edited:blocked\n",
  "later.txt": "edited:later\n",
  "unselected.txt": "keep this later edit\n",
}

const fixture = Effect.fnUntraced(function* () {
  const tmp = yield* tmpdirScoped()
  const directory = path.join(tmp.path, "project")
  const write = (files: Record<string, string>) =>
    Effect.promise(() =>
      Promise.all(Object.entries(files).map(([file, text]) => Bun.write(path.join(directory, file), text))),
    )
  yield* Effect.promise(() => fs.mkdir(path.join(directory, "blocked"), { recursive: true }))
  yield* write({
    "first.txt": "saved:first\n",
    "blocked/file.txt": "saved:blocked\n",
    "later.txt": "saved:later\n",
    "unselected.txt": "saved:unselected\n",
  })
  yield* Effect.promise(async () => {
    await $`git init -q`.cwd(directory).quiet()
    await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
  })
  const allow = Effect.promise(() => fs.chmod(path.join(directory, "blocked"), 0o755))
  yield* Effect.addFinalizer(() => allow)

  const open = Effect.fnUntraced(function* (filename = "session.sqlite") {
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
    const context = yield* Layer.buildWithScope(
      LayerNode.compile(
        LayerNode.group([
          Location.node,
          Snapshot.node,
          Database.node,
          Bus.node,
          SessionProjector.node,
          SessionStore.node,
        ]),
        {
          replacements: [
            Location.node.replace(Location.boundNode({ directory: AbsolutePath.make(directory) })),
            Global.node.replace(
              Global.layerWith({
                home: tmp.path,
                data: path.join(tmp.path, "data"),
                cache: path.join(tmp.path, "cache"),
                config: path.join(tmp.path, "config"),
                state: path.join(tmp.path, "state"),
              }),
            ),
            Database.node.replace(Database.configured({ path: path.join(tmp.path, filename) })),
            Bus.node.replace(Bus.configured({ persist: true })),
          ],
        },
      ),
      scope,
    )
    return yield* Effect.gen(function* () {
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const snapshot = yield* Snapshot.Service
      const location = yield* Location.Service
      const makeRevert = (overrides: Partial<Snapshot.Interface> = {}) =>
        SessionRevert.make().pipe(
          Effect.provideService(Bus.Service, bus),
          Effect.provideService(Database.Service, database),
          Effect.provideService(Snapshot.Service, { ...snapshot, ...overrides }),
          Effect.provideService(PluginSupervisor.Service, { awaitActivation: Effect.void }),
        )
      const revert = yield* makeRevert()
      const get = Effect.fnUntraced(function* () {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die("Missing recovery fixture session")
        return session
      })
      return {
        bus,
        db: database.db,
        snapshot,
        location,
        get,
        makeRevert,
        pending: database.db
          .select({ pending: SessionTable.revert_pending })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => row?.pending),
          ),
        preparations: bus.log({ aggregateID: sessionID }).pipe(
          Stream.runCollect,
          Effect.map((events) =>
            events.filter(Schema.is(SessionEvent.RevertEvent.Prepared)).map((event) => event.data),
          ),
        ),
        close: Scope.close(scope, Exit.void),
        stage: (messageID: SessionMessage.ID, files?: boolean) =>
          get().pipe(Effect.flatMap((session) => revert.stage({ session, messageID, files }))),
        clear: () => get().pipe(Effect.flatMap(revert.clear)),
      }
    }).pipe(Effect.provide(context))
  })
  const services = yield* open()
  yield* services.bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: services.location.project.id,
    location: { directory: AbsolutePath.make(directory) },
    slug: "recovery",
    version: "test",
  })
  const step = Effect.fnUntraced(function* (files: Record<string, string>) {
    const prompt = yield* services.bus.publish(SessionEvent.Synthetic, { sessionID, text: "Edit files" })
    const before = yield* services.snapshot.capture()
    if (!before) return yield* Effect.die("Missing initial snapshot")
    const assistantMessageID = SessionMessage.ID.create()
    yield* services.bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.ID.make("build"),
      model: { id: Model.ID.make("test"), providerID: Provider.ID.make("test") },
      snapshot: before,
    })
    yield* write(files)
    const after = yield* services.snapshot.capture()
    if (!after) return yield* Effect.die("Missing edited snapshot")
    yield* services.bus.publish(SessionEvent.Step.Ended, {
      sessionID,
      assistantMessageID,
      finish: "stop",
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      snapshot: after,
      files: yield* services.snapshot.files({ from: before, to: after }),
    })
    return SessionMessage.ID.fromEvent(prompt.id)
  })
  const earlier = yield* step({ "first.txt": edited["first.txt"], "blocked/file.txt": edited["blocked/file.txt"] })
  const later = yield* step({ "later.txt": edited["later.txt"] })
  yield* write({ "unselected.txt": edited["unselected.txt"] })
  const original = yield* services.snapshot.capture()
  if (!original) return yield* Effect.die("Missing original snapshot")
  return {
    ...services,
    earlier,
    later,
    original,
    open,
    write,
    allow,
    deny: Effect.promise(() => fs.chmod(path.join(directory, "blocked"), 0o555)),
    read: Effect.promise(async () =>
      Object.fromEntries(
        await Promise.all(
          Object.keys(edited).map(async (file) => [file, await Bun.file(path.join(directory, file)).text()]),
        ),
      ),
    ),
  }
})

describe("SessionRevert recovery", () => {
  permissionTest("clears a failed first stage back to the original files", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      yield* state.deny
      expect(yield* state.stage(state.earlier).pipe(Effect.flip)).toMatchObject({
        _tag: "Snapshot.Error",
        operation: "restore",
      })
      expect((yield* state.read)["first.txt"]).toBe("saved:first\n")
      expect((yield* state.get()).revert).toBeUndefined()
      expect(yield* state.pending).toMatchObject({ snapshot: state.original })
      yield* state.allow
      yield* state.clear()
      expect(yield* state.read).toEqual(edited)
      expect((yield* state.get()).revert).toBeUndefined()
      expect(yield* state.pending).toBeNull()
    }),
  )

  permissionTest("retries the same boundary without adopting partially restored files as its original", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      yield* state.deny
      yield* state.stage(state.earlier).pipe(Effect.flip)
      yield* state.allow
      const staged = yield* state.stage(state.earlier)
      expect(staged.snapshot).toBe(state.original)
      expect(yield* state.read).toEqual({
        "first.txt": "saved:first\n",
        "blocked/file.txt": "saved:blocked\n",
        "later.txt": "saved:later\n",
        "unselected.txt": edited["unselected.txt"],
      })
      expect(yield* state.pending).toBeNull()
      yield* state.clear()
      expect(yield* state.read).toEqual(edited)
    }),
  )

  permissionTest("unwinds dropped paths when retrying at a different boundary", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      yield* state.deny
      yield* state.stage(state.earlier).pipe(Effect.flip)
      yield* state.allow
      const staged = yield* state.stage(state.later)
      expect(staged.snapshot).toBe(state.original)
      expect(staged.files?.map((file) => file.file)).toEqual(["later.txt"])
      expect(yield* state.read).toEqual({ ...edited, "later.txt": "saved:later\n" })
      // Resolved paths must not remain protected across subsequent successful stages.
      yield* state.write({ "first.txt": "new edit after moving the boundary\n" })
      yield* state.stage(state.later)
      yield* state.clear()
      expect(yield* state.read).toEqual({ ...edited, "first.txt": "new edit after moving the boundary\n" })
    }),
  )

  permissionTest("protects only new paths when a successful stage is followed by failed restaging", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const staged = yield* state.stage(state.later)
      yield* state.deny
      yield* state.stage(state.earlier).pipe(Effect.flip)
      expect((yield* state.get()).revert).toEqual(staged)
      expect(yield* state.preparations).toEqual([
        { sessionID, snapshot: state.original, paths: [RelativePath.make("later.txt")] },
        { sessionID, paths: ["blocked/file.txt", "first.txt"].map((file) => RelativePath.make(file)) },
      ])
      yield* state.allow
      yield* state.clear()
      expect(yield* state.read).toEqual(edited)
      expect(yield* state.pending).toBeNull()
    }),
  )

  permissionTest("keeps the first original through repeated failed attempts without redundant preparation events", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      yield* state.deny
      yield* state.stage(state.earlier).pipe(Effect.flip)
      yield* state.stage(state.earlier).pipe(Effect.flip)
      expect(yield* state.preparations).toEqual([
        {
          sessionID,
          snapshot: state.original,
          paths: ["blocked/file.txt", "first.txt", "later.txt"].map((file) => RelativePath.make(file)),
        },
      ])
      expect(yield* state.pending).toMatchObject({ snapshot: state.original })
      yield* state.allow
      yield* state.clear()
      expect(yield* state.read).toEqual(edited)
    }),
  )

  permissionTest("accumulates new protected paths across failures at different boundaries", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const revert = yield* state.makeRevert({
        diff: () => Effect.fail(new Snapshot.Error({ operation: "diff", message: "Diff unavailable" })),
      })
      yield* revert.stage({ session: yield* state.get(), messageID: state.later }).pipe(Effect.flip)
      yield* state.deny
      yield* state.stage(state.earlier).pipe(Effect.flip)
      expect(yield* state.preparations).toEqual([
        { sessionID, snapshot: state.original, paths: [RelativePath.make("later.txt")] },
        { sessionID, paths: ["blocked/file.txt", "first.txt"].map((file) => RelativePath.make(file)) },
      ])
      yield* state.allow
      expect((yield* state.stage(state.earlier)).snapshot).toBe(state.original)
      yield* state.clear()
      expect(yield* state.read).toEqual(edited)
    }),
  )

  permissionTest("keeps recovery available when clearing a staged revert also fails", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const staged = yield* state.stage(state.earlier)
      yield* state.deny
      expect(yield* state.clear().pipe(Effect.flip)).toMatchObject({ _tag: "Snapshot.Error", operation: "restore" })
      expect((yield* state.get()).revert).toEqual(staged)
      yield* state.allow
      yield* state.clear()
      expect(yield* state.read).toEqual(edited)
    }),
  )

  permissionTest("unwinds failed preparation before staging with files:false", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      yield* state.deny
      yield* state.stage(state.earlier).pipe(Effect.flip)
      yield* state.allow
      expect(yield* state.stage(state.later, false)).toEqual({
        messageID: state.later,
        snapshot: state.original,
        files: [],
      })
      expect(yield* state.read).toEqual(edited)
      expect(yield* state.pending).toBeNull()
      yield* state.write({ "first.txt": "new edit after files:false\n" })
      yield* state.clear()
      expect(yield* state.read).toEqual({ ...edited, "first.txt": "new edit after files:false\n" })
    }),
  )

  it.live("does not prepare or change files for a first files:false stage", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      expect((yield* state.stage(state.earlier, false)).files).toEqual([])
      expect(yield* state.read).toEqual(edited)
      expect(yield* state.preparations).toEqual([])
      expect(yield* state.pending).toBeNull()
      yield* state.clear()
      expect(yield* state.read).toEqual(edited)
    }),
  )

  it.live("fails before changing files when capture cannot supply an original", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const revert = yield* state.makeRevert({ capture: () => Effect.undefined })
      expect(
        yield* revert.stage({ session: yield* state.get(), messageID: state.earlier }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Snapshot.Error", operation: "capture" })
      expect(yield* state.read).toEqual(edited)
      expect(yield* state.pending).toBeNull()
      expect(yield* state.preparations).toEqual([])
      expect((yield* state.get()).revert).toBeUndefined()
      expect(
        (yield* revert.stage({ session: yield* state.get(), messageID: state.earlier, files: false })).files,
      ).toEqual([])
    }),
  )

  it.live("does not record preparation for a nonexistent boundary", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      expect(yield* state.stage(SessionMessage.ID.create()).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.MessageNotFoundError",
      })
      expect(yield* state.preparations).toEqual([])
      expect(yield* state.pending).toBeNull()
      expect(yield* state.read).toEqual(edited)
    }),
  )

  it.live("retains the original when diff fails after files have been restored", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const revert = yield* state.makeRevert({
        diff: () => Effect.fail(new Snapshot.Error({ operation: "diff", message: "Diff unavailable" })),
      })
      expect(
        yield* revert.stage({ session: yield* state.get(), messageID: state.earlier }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Snapshot.Error", operation: "diff" })
      expect((yield* state.read)["blocked/file.txt"]).toBe("saved:blocked\n")
      expect((yield* state.get()).revert).toBeUndefined()
      expect(yield* state.pending).toMatchObject({ snapshot: state.original })
      yield* state.clear()
      expect(yield* state.read).toEqual(edited)
    }),
  )

  permissionTest("recovers failed preparation after reopening the database and Snapshot services", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      yield* state.deny
      yield* state.stage(state.earlier).pipe(Effect.flip)
      yield* state.close
      yield* state.allow
      const restarted = yield* state.open()
      expect((yield* restarted.get()).revert).toBeUndefined()
      expect((yield* restarted.stage(state.later)).snapshot).toBe(state.original)
      expect(yield* state.read).toEqual({ ...edited, "later.txt": "saved:later\n" })
      yield* restarted.clear()
      expect(yield* state.read).toEqual(edited)
    }),
  )

  permissionTest("replays unfinished preparation into a fresh database before clearing", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      yield* state.deny
      yield* state.stage(state.earlier).pipe(Effect.flip)
      const pending = yield* state.pending
      const partial = yield* state.read
      const events = yield* state.db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      yield* state.close
      yield* state.allow
      const replayed = yield* state.open("replayed.sqlite")
      yield* Effect.forEach(events, (event) =>
        replayed.bus.replay({
          id: event.id,
          created: event.created,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        }),
      )
      expect(yield* state.read).toEqual(partial)
      expect(yield* replayed.pending).toEqual(pending)
      expect((yield* replayed.get()).revert).toBeUndefined()
      yield* replayed.clear()
      expect(yield* state.read).toEqual(edited)
      expect(yield* replayed.pending).toBeNull()
    }),
  )
})
