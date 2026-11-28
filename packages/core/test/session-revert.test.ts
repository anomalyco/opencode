import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { Context, Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionMessageTable } from "@opencode/core/session/sql"
import { Snapshot } from "@opencode/core/snapshot"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionInbox.node, Session.node, LocationServiceMap.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Global.node.replace(tempGlobalLayer),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)

const setup = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  const directory = tmp.path
  yield* Effect.promise(async () => {
    await Bun.write(path.join(directory, "file.txt"), "original")
    await $`git init -q`.cwd(directory).quiet()
    await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
  })
  const sessions = yield* Session.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const root = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
  const locations = yield* LocationServiceMap.Service
  const context = yield* locations.contextEffect(root.location)
  const plugins = Context.get(context, Plugin.Service)
  yield* plugins.awaitActivation
  const snapshots = Context.get(context, Snapshot.Service)
  const prompt = Effect.fnUntraced(function* (sessionID: Session.ID, text: string) {
    const result = yield* sessions.prompt({ sessionID, text, resume: false })
    yield* SessionInbox.promote(database.db, bus, sessionID, "steer")
    return result.id
  })
  const step = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    action: (assistantMessageID: SessionMessage.ID) => Effect.Effect<unknown>,
  ) {
    const assistantMessageID = SessionMessage.ID.create()
    const start = (yield* snapshots.capture())!
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.defaultID,
      model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
      snapshot: start,
      started: Date.now(),
    })
    yield* action(assistantMessageID)
    const end = (yield* snapshots.capture())!
    yield* bus.publish(SessionEvent.Step.Ended, {
      sessionID,
      assistantMessageID,
      finish: "stop",
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      snapshot: end,
      files: yield* snapshots.files({ from: start, to: end }),
    })
  })
  const delegate = (parent: Session.ID, child: Session.ID, promptID?: SessionMessage.ID) =>
    step(parent, (assistantMessageID) =>
      Effect.gen(function* () {
        const call = { sessionID: parent, assistantMessageID, id: "call" }
        yield* bus.publish(SessionEvent.Tool.Input.Started, { ...call, name: "subagent" })
        yield* bus.publish(SessionEvent.Tool.Called, {
          ...call,
          input: promptID ? { sessionID: child } : {},
          executed: false,
        })
        yield* bus.publish(SessionEvent.Tool.Success, {
          ...call,
          executed: false,
          content: [{ type: "text", text: "started" }],
          metadata: { sessionID: child, ...(promptID ? { promptMessageID: promptID } : {}) },
        })
      }),
    )
  const launch = Effect.fnUntraced(function* (parent: Session.ID, text: string) {
    const child = yield* sessions.create({ parentID: parent })
    yield* delegate(parent, child.id)
    yield* prompt(child.id, text)
    return child.id
  })
  const write = (file: string, text: string) => Effect.promise(() => Bun.write(path.join(directory, file), text))
  const read = (file: string) => Effect.promise(() => Bun.file(path.join(directory, file)).text())
  const exists = (file: string) => Effect.promise(() => Bun.file(path.join(directory, file)).exists())
  return { root, sessions, database, bus, prompt, step, delegate, launch, write, read, exists }
})

describe("Session.revert files", () => {
  it.live(
    "undoes and restores a file rename without losing either path",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const original = path.join(directory, "old name.txt")
        const renamed = path.join(directory, "new name.txt")
        yield* Effect.promise(async () => {
          await fs.mkdir(directory)
          await Bun.write(original, "Preserve this content.\n")
          await Bun.write(path.join(directory, "unrelated.txt"), "Unrelated content.\n")
          await $`git init -q`.cwd(directory).quiet()
          await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
        })

        const session = yield* Session.Service
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const created = yield* session.create({ location: { directory: AbsolutePath.make(directory) } })
        const prompt = yield* session.prompt({ sessionID: created.id, text: "Rename the file", resume: false })
        yield* SessionInbox.promote(database.db, bus, created.id, "steer")

        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          const snapshot = yield* Snapshot.Service
          const before = yield* snapshot.capture()
          if (!before) throw new Error("Initial snapshot missing")
          const assistantMessageID = SessionMessage.ID.create()
          yield* bus.publish(SessionEvent.Step.Started, {
            sessionID: created.id,
            assistantMessageID,
            agent: Agent.defaultID,
            model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
            snapshot: before,
            started: 0,
          })
          yield* Effect.promise(() => fs.rename(original, renamed))
          const after = yield* snapshot.capture()
          if (!after) throw new Error("Renamed snapshot missing")
          yield* bus.publish(SessionEvent.Step.Ended, {
            sessionID: created.id,
            assistantMessageID,
            finish: "stop",
            cost: Money.USD.zero,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            snapshot: after,
            files: yield* snapshot.files({ from: before, to: after }),
          })

          yield* Effect.promise(() => Bun.write(path.join(directory, "unrelated.txt"), "Keep this later edit.\n"))
          const reverted = yield* session.revert.stage({ sessionID: created.id, messageID: prompt.id })
          expect({
            original: yield* Effect.promise(() => Bun.file(original).exists()),
            renamed: yield* Effect.promise(() => Bun.file(renamed).exists()),
          }).toEqual({ original: true, renamed: false })
          expect(yield* Effect.promise(() => Bun.file(original).text())).toBe("Preserve this content.\n")
          expect(reverted.files?.map((file) => [file.file, file.status])).toEqual([
            ["new name.txt", "deleted"],
            ["old name.txt", "added"],
          ])
          expect(yield* Effect.promise(() => Bun.file(path.join(directory, "unrelated.txt")).text())).toBe(
            "Keep this later edit.\n",
          )

          yield* session.revert.clear(created.id)
          expect(yield* Effect.promise(() => Bun.file(original).exists())).toBe(false)
          expect(yield* Effect.promise(() => Bun.file(renamed).text())).toBe("Preserve this content.\n")
          expect(yield* Effect.promise(() => Bun.file(path.join(directory, "unrelated.txt")).text())).toBe(
            "Keep this later edit.\n",
          )
          expect((yield* session.get(created.id)).revert).toBeUndefined()
        }).pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))
      }),
    // Real Location/plugin startup and Git snapshots can exceed five seconds under CI load.
    { timeout: 15_000 },
  )

  it.live(
    "reverts a background child edit and restores it on clear",
    Effect.gen(function* () {
      const f = yield* setup
      const boundary = yield* f.prompt(f.root.id, "Delegate an edit")
      const child = yield* f.launch(f.root.id, "Edit file.txt")
      yield* f.step(child, () => f.write("file.txt", "child"))

      const result = yield* f.sessions.revert.stage({ sessionID: f.root.id, messageID: boundary })
      expect(result.files?.map((file) => file.file)).toEqual(["file.txt"])
      expect(yield* f.read("file.txt")).toBe("original")
      yield* f.sessions.revert.clear(f.root.id)
      expect(yield* f.read("file.txt")).toBe("child")
    }),
  )

  it.live(
    "keeps a direct child prompt between two delegated prompts",
    Effect.gen(function* () {
      const f = yield* setup
      const boundary = yield* f.prompt(f.root.id, "First delegation")
      const child = yield* f.launch(f.root.id, "First task")
      yield* f.step(child, () => f.write("first.txt", "first"))

      yield* f.prompt(child, "Direct child task")
      yield* f.step(child, () => f.write("direct.txt", "keep"))

      yield* f.prompt(f.root.id, "Second delegation")
      const next = yield* f.sessions.prompt({ sessionID: child, text: "Second task", resume: false })
      yield* f.delegate(f.root.id, child, next.id)
      yield* SessionInbox.promote(f.database.db, f.bus, child, "steer")
      yield* f.step(child, () => f.write("second.txt", "second"))

      yield* f.sessions.revert.stage({ sessionID: f.root.id, messageID: boundary })
      expect(yield* f.exists("first.txt")).toBe(false)
      expect(yield* f.exists("second.txt")).toBe(false)
      expect(yield* f.read("direct.txt")).toBe("keep")
    }),
  )

  it.live(
    "preserves a sibling edit between delegated steps on the same path",
    Effect.gen(function* () {
      const f = yield* setup
      yield* f.prompt(f.root.id, "Earlier sibling task")
      const sibling = yield* f.launch(f.root.id, "Write first")
      yield* f.step(sibling, () => f.write("file.txt", "sibling first"))

      const boundary = yield* f.prompt(f.root.id, "Target child task")
      const child = yield* f.launch(f.root.id, "Write twice")
      yield* f.step(child, () => f.write("file.txt", "child first"))
      yield* f.step(sibling, () => f.write("file.txt", "sibling middle"))
      yield* f.step(child, () => f.write("file.txt", "child second"))

      yield* f.sessions.revert.stage({ sessionID: f.root.id, messageID: boundary })
      expect(yield* f.read("file.txt")).toBe("sibling middle")
    }),
  )

  it.live(
    "reverts a legacy follow-up delivered after its tool call",
    Effect.gen(function* () {
      const f = yield* setup
      yield* f.prompt(f.root.id, "First delegation")
      const child = yield* f.launch(f.root.id, "Earlier task")
      yield* f.step(child, () => f.write("file.txt", "earlier"))

      const boundary = yield* f.prompt(f.root.id, "Legacy follow-up")
      const queued = SessionMessage.ID.create()
      yield* f.step(f.root.id, (assistantMessageID) =>
        Effect.gen(function* () {
          const call = { sessionID: f.root.id, assistantMessageID, id: "legacy-call" }
          yield* f.bus.publish(SessionEvent.Tool.Input.Started, { ...call, name: "subagent" })
          yield* f.bus.publish(SessionEvent.Tool.Called, {
            ...call,
            input: { sessionID: child, prompt: "Later task" },
            executed: false,
          })
          yield* f.sessions
            .prompt({ id: queued, sessionID: child, text: "Later task", resume: false })
            .pipe(Effect.orDie)
          yield* f.bus.publish(SessionEvent.Tool.Success, {
            ...call,
            executed: false,
            content: [{ type: "text", text: "queued" }],
            metadata: { sessionID: child },
          })
        }),
      )
      const afterTool = Date.now()
      yield* SessionInbox.promote(f.database.db, f.bus, child, "steer")
      const delivered = yield* f.database.db
        .update(SessionMessageTable)
        .set({ time_created: afterTool + 1000 })
        .where(eq(SessionMessageTable.id, queued))
        .returning({ created: SessionMessageTable.time_created })
        .get()
        .pipe(Effect.orDie)
      expect(delivered?.created).toBeGreaterThan(afterTool)
      yield* f.step(child, () => f.write("file.txt", "later"))

      yield* f.sessions.revert.stage({ sessionID: f.root.id, messageID: boundary })
      expect(yield* f.read("file.txt")).toBe("earlier")
    }),
  )

  it.live(
    "reverts a nested delegated child edit",
    Effect.gen(function* () {
      const f = yield* setup
      const boundary = yield* f.prompt(f.root.id, "Delegate nested work")
      const child = yield* f.launch(f.root.id, "Ask a grandchild")
      const grandchild = yield* f.launch(child, "Write nested.txt")
      yield* f.step(grandchild, () => f.write("nested.txt", "grandchild"))

      yield* f.sessions.revert.stage({ sessionID: f.root.id, messageID: boundary })
      expect(yield* f.exists("nested.txt")).toBe(false)
      expect(yield* f.read("file.txt")).toBe("original")
    }),
  )
})
