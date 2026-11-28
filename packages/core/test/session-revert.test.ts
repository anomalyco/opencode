import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
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
import { Snapshot } from "@opencode/core/snapshot"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { initRepo } from "./fixture/git"
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

describe("Session.revert files", () => {
  it.live("undoes a background child's edit after the parent step and restores it on clear", () =>
    Effect.gen(function* () {
      const f = yield* setup
      const prompt = yield* f.prompt(f.parent.id)
      const parent = yield* f.start(f.parent.id)
      const child = yield* f.sessions.create({ parentID: f.parent.id })
      yield* f.delegate(parent, child.id, true)
      yield* f.end(parent)
      const edit = yield* f.start(child.id)
      yield* f.write("line 1\nline 2\nline 3\n")
      yield* f.end(edit)
      const unrelated = path.join(f.directory, "unrelated.txt")
      yield* Effect.promise(() => Bun.write(unrelated, "Keep this later edit.\n"))

      const transcript = yield* f.sessions.revert.stage({ sessionID: f.parent.id, messageID: prompt.id, files: false })
      expect(transcript.files).toEqual([])
      expect(yield* f.read()).toBe("line 1\nline 2\nline 3\n")
      const reverted = yield* f.sessions.revert.stage({ sessionID: f.parent.id, messageID: prompt.id })
      expect(yield* f.read()).toBe("line 1\nline 2\n")
      expect(reverted.files?.map((entry) => entry.file)).toEqual(["file.txt"])
      expect(yield* Effect.promise(() => Bun.file(unrelated).text())).toBe("Keep this later edit.\n")
      yield* f.sessions.revert.clear(f.parent.id)
      expect(yield* f.read()).toBe("line 1\nline 2\nline 3\n")
    }),
  )

  it.live("uses the first snapshot when a parent edits a file after its background child", () =>
    Effect.gen(function* () {
      const f = yield* setup
      const prompt = yield* f.prompt(f.parent.id)
      const parent = yield* f.start(f.parent.id)
      const child = yield* f.sessions.create({ parentID: f.parent.id })
      yield* f.delegate(parent, child.id)
      yield* f.end(parent)
      const edit = yield* f.start(child.id)
      yield* f.write("Child edit.\n")
      yield* f.end(edit)
      const later = yield* f.start(f.parent.id)
      yield* f.write("Parent edit.\n")
      yield* f.end(later)

      yield* f.sessions.revert.stage({ sessionID: f.parent.id, messageID: prompt.id })
      expect(yield* f.read()).toBe("line 1\nline 2\n")
      yield* f.sessions.revert.clear(f.parent.id)
      expect(yield* f.read()).toBe("Parent edit.\n")
    }),
  )

  it.live("preserves earlier edits when a reverted prompt continues an existing child", () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* f.prompt(f.parent.id)
      const earlier = yield* f.start(f.parent.id)
      const child = yield* f.sessions.create({ parentID: f.parent.id })
      yield* f.delegate(earlier, child.id)
      yield* f.end(earlier)
      const first = yield* f.start(child.id)
      yield* f.write("Earlier child edit.\n")
      yield* f.end(first)

      const prompt = yield* f.prompt(f.parent.id)
      const parent = yield* f.start(f.parent.id)
      yield* f.delegate(parent, child.id)
      yield* f.end(parent)
      const next = yield* f.start(child.id)
      yield* f.write("Later child edit.\n")
      yield* f.end(next)

      yield* f.sessions.revert.stage({ sessionID: f.parent.id, messageID: prompt.id })
      expect(yield* f.read()).toBe("Earlier child edit.\n")
    }),
  )

  it.live("includes nested background children", () =>
    Effect.gen(function* () {
      const f = yield* setup
      const prompt = yield* f.prompt(f.parent.id)
      const parent = yield* f.start(f.parent.id)
      const child = yield* f.sessions.create({ parentID: f.parent.id })
      yield* f.delegate(parent, child.id)
      yield* f.end(parent)
      const nested = yield* f.start(child.id)
      const grandchild = yield* f.sessions.create({ parentID: child.id })
      yield* f.delegate(nested, grandchild.id)
      yield* f.end(nested)
      const edit = yield* f.start(grandchild.id)
      yield* f.write("Nested edit.\n")
      yield* f.end(edit)

      yield* f.sessions.revert.stage({ sessionID: f.parent.id, messageID: prompt.id })
      expect(yield* f.read()).toBe("line 1\nline 2\n")
    }),
  )

  it.live("keeps work delegated before the reverted prompt even when it finishes later", () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* f.prompt(f.parent.id)
      const earlier = yield* f.start(f.parent.id)
      const old = yield* f.sessions.create({ parentID: f.parent.id })
      yield* f.delegate(earlier, old.id)
      yield* f.end(earlier)
      const prompt = yield* f.prompt(f.parent.id)
      const parent = yield* f.start(f.parent.id)
      const child = yield* f.sessions.create({ parentID: f.parent.id })
      yield* f.delegate(parent, child.id)
      yield* f.end(parent)

      const keep = path.join(f.directory, "earlier-task.txt")
      const previous = yield* f.start(old.id)
      yield* Effect.promise(() => Bun.write(keep, "Earlier task result.\n"))
      yield* f.end(previous)
      const edit = yield* f.start(child.id)
      yield* f.write("Reverted task result.\n")
      yield* f.end(edit)

      yield* f.sessions.revert.stage({ sessionID: f.parent.id, messageID: prompt.id })
      expect(yield* f.read()).toBe("line 1\nline 2\n")
      expect(yield* Effect.promise(() => Bun.file(keep).text())).toBe("Earlier task result.\n")
    }),
  )

  it.live("leaves a child's changes in another project untouched", () =>
    Effect.gen(function* () {
      const f = yield* setup
      const prompt = yield* f.prompt(f.parent.id)
      const parent = yield* f.start(f.parent.id)
      const directory = path.join(f.directory, "..", "other")
      const file = path.join(directory, "file.txt")
      yield* Effect.promise(async () => {
        await fs.mkdir(directory)
        await initRepo(directory)
        await Bun.write(file, "Other project.\n")
      })
      const destination = yield* f.sessions.create({
        location: { directory: AbsolutePath.make(directory) },
      })
      const child = yield* f.sessions.create({ parentID: f.parent.id })
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.Moved, {
        sessionID: child.id,
        location: destination.location,
        projectID: destination.projectID,
      })
      yield* f.delegate(parent, child.id)
      yield* f.end(parent)
      const edit = yield* f.start(child.id)
      yield* Effect.promise(() => Bun.write(file, "Keep other project edit.\n"))
      yield* f.end(edit)

      yield* f.sessions.revert.stage({ sessionID: f.parent.id, messageID: prompt.id })
      expect(yield* f.read()).toBe("line 1\nline 2\n")
      expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("Keep other project edit.\n")
    }),
  )

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
})

const setup = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  const directory = path.join(tmp.path, "project")
  const file = path.join(directory, "file.txt")
  yield* Effect.promise(async () => {
    await fs.mkdir(directory)
    await initRepo(directory)
    await Bun.write(file, "line 1\nline 2\n")
  })
  const sessions = yield* Session.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
  const model = { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") }
  const locations = yield* LocationServiceMap.Service
  const prompt = (sessionID: Session.ID) =>
    Effect.gen(function* () {
      const input = yield* sessions.prompt({ sessionID, text: "Update the file", resume: false })
      yield* SessionInbox.promote(database.db, bus, sessionID, "steer")
      return input
    })
  const start = (sessionID: Session.ID) =>
    Effect.gen(function* () {
      const current = yield* sessions.get(sessionID)
      const snapshot = yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        return yield* Snapshot.Service
      }).pipe(Effect.provide(locations.get(current.location)))
      const before = yield* snapshot.capture()
      if (!before) throw new Error("Initial snapshot missing")
      const assistantMessageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: Agent.defaultID,
        model,
        snapshot: before,
        started: Date.now(),
      })
      return { sessionID, assistantMessageID, before, snapshot }
    })
  const end = (step: Effect.Success<ReturnType<typeof start>>) =>
    Effect.gen(function* () {
      const after = yield* step.snapshot.capture()
      if (!after) throw new Error("Final snapshot missing")
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID: step.sessionID,
        assistantMessageID: step.assistantMessageID,
        finish: "stop",
        cost: Money.USD.zero,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        snapshot: after,
        files: yield* step.snapshot.files({ from: step.before, to: after }),
      })
    })
  const delegate = (step: Effect.Success<ReturnType<typeof start>>, childID: Session.ID, legacy = false) =>
    Effect.gen(function* () {
      const input = yield* prompt(childID)
      const call = {
        sessionID: step.sessionID,
        assistantMessageID: step.assistantMessageID,
        id: `call-${step.assistantMessageID}`,
      }
      yield* bus.publish(SessionEvent.Tool.Input.Started, { ...call, name: "subagent" })
      yield* bus.publish(SessionEvent.Tool.Called, { ...call, input: {}, executed: true })
      yield* bus.publish(SessionEvent.Tool.Success, {
        ...call,
        executed: true,
        content: [{ type: "text", text: "Working in the background" }],
        metadata: { sessionID: childID, status: "running", ...(legacy ? {} : { promptID: input.id }) },
      })
    })
  return {
    directory,
    sessions,
    parent,
    prompt,
    start,
    end,
    delegate,
    read: () => Effect.promise(() => Bun.file(file).text()),
    write: (text: string) => Effect.promise(() => Bun.write(file, text)),
  }
})
