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
import { MessageNotFoundError } from "@opencode/core/session/error"
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
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, SessionInbox.node, LocationServiceMap.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Global.node.replace(tempGlobalLayer),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)

describe("Session.revert admitted boundaries", () => {
  const admitted = (id: SessionMessage.ID) => Database.Service.use(({ db }) => SessionInbox.find(db, id))

  const setupSession = Effect.fn(function* (tmp: { path: string }) {
    const directory = path.join(tmp.path, "project")
    yield* Effect.promise(async () => {
      await fs.mkdir(directory)
      await Bun.write(path.join(directory, "file.txt"), "Content.\n")
      await $`git init -q`.cwd(directory).quiet()
      await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
    })
    const session = yield* Session.Service
    const created = yield* session.create({ location: { directory: AbsolutePath.make(directory) } })
    return { session, created }
  })

  it.live("stages an admitted-but-unpromoted user message with no file restore", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, created } = yield* setupSession(tmp)

      const prompt = yield* session.prompt({ sessionID: created.id, text: "Undo me", resume: false })
      expect(yield* session.messages({ sessionID: created.id })).toEqual([])
      expect(yield* admitted(prompt.id)).toMatchObject({ id: prompt.id, type: "user" })

      const reverted = yield* session.revert.stage({ sessionID: created.id, messageID: prompt.id })
      expect(reverted.messageID).toBe(prompt.id)
      expect(reverted.files).toEqual([])
      // Staging must not promote the input early.
      expect(yield* admitted(prompt.id)).toMatchObject({ id: prompt.id, type: "user" })
      expect(yield* session.messages({ sessionID: created.id })).toEqual([])
    }),
  )

  it.live("stages a promoted user message as before", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, created } = yield* setupSession(tmp)
      const database = yield* Database.Service
      const bus = yield* Bus.Service

      const prompt = yield* session.prompt({ sessionID: created.id, text: "Undo me", resume: false })
      yield* SessionInbox.promote(database.db, bus, created.id, "steer")

      const reverted = yield* session.revert.stage({ sessionID: created.id, messageID: prompt.id })
      expect(reverted.messageID).toBe(prompt.id)
      expect(yield* admitted(prompt.id)).toBeUndefined()
      expect((yield* session.messages({ sessionID: created.id })).map((message) => message.id)).toContain(
        prompt.id,
      )
    }),
  )

  it.live("commits a staged revert on an unpromoted boundary and drops only the inbox suffix", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, created } = yield* setupSession(tmp)

      const earlier = yield* session.prompt({ sessionID: created.id, text: "Keep me", resume: false })
      const boundary = yield* session.prompt({ sessionID: created.id, text: "Undo me", resume: false })
      const later = yield* session.prompt({ sessionID: created.id, text: "Drop me", resume: false })
      yield* session.revert.stage({ sessionID: created.id, messageID: boundary.id })

      yield* session.revert.commit(created.id)

      expect((yield* session.get(created.id)).revert).toBeUndefined()
      expect(yield* admitted(earlier.id)).toMatchObject({ id: earlier.id })
      expect(yield* admitted(boundary.id)).toBeUndefined()
      expect(yield* admitted(later.id)).toBeUndefined()
      expect(yield* session.messages({ sessionID: created.id })).toEqual([])
    }),
  )

  it.live("rejects a compaction inbox item as a revert boundary", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { session, created } = yield* setupSession(tmp)
      const inbox = yield* SessionInbox.Service

      const compaction = yield* inbox.admitCompaction({
        id: SessionMessage.ID.create(),
        sessionID: created.id,
        delivery: "queue",
      })
      expect(yield* admitted(compaction.id)).toMatchObject({ type: "compaction" })

      expect(
        yield* session.revert
          .stage({ sessionID: created.id, messageID: compaction.id })
          .pipe(Effect.flip),
      ).toEqual(new MessageNotFoundError({ sessionID: created.id, messageID: compaction.id }))
    }),
  )

  it.live("does not touch another session's inbox entries when committing", () =>
    Effect.gen(function* () {
      const tmpA = yield* tmpdirScoped()
      const tmpB = yield* tmpdirScoped()
      const { session, created: first } = yield* setupSession(tmpA)
      const { created: second } = yield* setupSession(tmpB)

      const kept = yield* session.prompt({ sessionID: second.id, text: "Other session", resume: false })
      const boundary = yield* session.prompt({ sessionID: first.id, text: "Undo me", resume: false })
      yield* session.revert.stage({ sessionID: first.id, messageID: boundary.id })

      yield* session.revert.commit(first.id)

      expect(yield* admitted(kept.id)).toMatchObject({ id: kept.id })
      expect(yield* admitted(boundary.id)).toBeUndefined()
    }),
  )
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
})
