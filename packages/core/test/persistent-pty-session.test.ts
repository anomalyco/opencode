import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Option, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Instance } from "@opencode/core/instance/service"
import { Location } from "@opencode/core/location"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { SessionEnvironment } from "@opencode/core/session/environment"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Removed, Updated } from "@opencode/schema/persistent-pty"
import { fakeDaemon } from "./fixture/persistent-pty-daemon"
import { it } from "./lib/effect"
import { globalProjectNode } from "./lib/project"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"

const transport = Layer.succeed(
  SessionModelTransport.Service,
  SessionModelTransport.Service.of({
    bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
    close: () => Effect.void,
    closeAll: Effect.void,
  }),
)

describe("PersistentPty session cleanup", () => {
  it.live("removes a deleted session's terminals", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        const session = yield* Session.Service
        const pty = yield* PersistentPty.Service
        const bus = yield* Bus.Service
        const directory = yield* tmpdirScoped()
        const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
        const deleted = yield* session.create({ location })
        const kept = yield* session.create({ location })
        const terminal = yield* pty.create(deleted.id, { args: [], cwd: directory.path, title: "deleted", env: {} })
        const other = yield* pty.create(kept.id, { args: [], cwd: directory.path, title: "kept", env: {} })
        const removed = yield* nextRemoved(bus)

        yield* session.remove(deleted.id)

        expect((yield* Fiber.join(removed)).data).toEqual({ sessionID: deleted.id, ptyID: terminal.id })
        expect(yield* pty.list(deleted.id)).toEqual([])
        expect((yield* pty.list()).map((item) => item.id)).toEqual([other.id])
      }).pipe(Effect.provide(layer(daemon)))
    }),
  )

  it.live("keeps cleaning up later deletions after a terminal fails to stop", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        const session = yield* Session.Service
        const pty = yield* PersistentPty.Service
        const bus = yield* Bus.Service
        const directory = yield* tmpdirScoped()
        const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
        const first = yield* session.create({ location })
        const second = yield* session.create({ location })
        const stuck = yield* pty.create(first.id, { args: [], cwd: directory.path, title: "stuck", env: {} })
        const terminal = yield* pty.create(second.id, { args: [], cwd: directory.path, title: "second", env: {} })
        yield* pty.control(stuck.id, "att", 80, 24)
        daemon.failTerminate.add(stuck.id)
        const removed = yield* nextRemoved(bus)

        yield* session.remove(first.id)
        yield* session.remove(second.id)

        expect((yield* Fiber.join(removed)).data).toEqual({ sessionID: second.id, ptyID: terminal.id })
        expect((yield* pty.list()).map((item) => item.id)).toEqual([stuck.id])
        // The fake daemon rejects read_rows, so a stale selection would fail instead of returning null.
        expect(yield* pty.read(first.id)).toBeNull()
      }).pipe(Effect.provide(layer(daemon)))
    }),
  )
})

describe("PersistentPty rename", () => {
  it.live("renames a terminal, publishes the update and clears the user title", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon(["rename"])
      yield* Effect.gen(function* () {
        const pty = yield* PersistentPty.Service
        const bus = yield* Bus.Service
        const directory = yield* tmpdirScoped()
        const sessionID = Session.ID.make("ses_rename")
        const terminal = yield* pty.create(sessionID, { args: [], cwd: directory.path, title: "test", env: {} })
        expect(terminal.userTitle).toBeNull()
        const updated = yield* nextUpdated(bus)

        const renamed = yield* pty.rename(terminal.id, "build")

        expect(renamed).toMatchObject({ id: terminal.id, title: "build", userTitle: "build" })
        expect((yield* Fiber.join(updated)).data).toEqual({ sessionID, terminal: renamed })
        expect(yield* pty.rename(terminal.id, null)).toMatchObject({ title: "test", userTitle: null })
      }).pipe(Effect.provide(layer(daemon)))
    }),
  )

  it.live("refuses to rename on a daemon without the rename feature and never sends it", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        const pty = yield* PersistentPty.Service
        const directory = yield* tmpdirScoped()
        const terminal = yield* pty.create(Session.ID.make("ses_rename"), {
          args: [],
          cwd: directory.path,
          title: "test",
          env: {},
        })
        expect(terminal.userTitle).toBeNull()

        const error = yield* Effect.flip(pty.rename(terminal.id, "build"))

        expect(error).toEqual(new PersistentPty.UnsupportedError({ feature: "rename" }))
        expect(daemon.ops).not.toContain("rename")
        expect((yield* pty.get(terminal.id)).title).toBe("test")
      }).pipe(Effect.provide(layer(daemon)))
    }),
  )
})

const nextUpdated = (bus: Bus.Interface) =>
  bus
    .subscribe(Updated)
    .pipe(Stream.runHead, Effect.map(Option.getOrThrow), Effect.forkScoped({ startImmediately: true }))

const nextRemoved = (bus: Bus.Interface) =>
  bus
    .subscribe(Removed)
    .pipe(Stream.runHead, Effect.map(Option.getOrThrow), Effect.forkScoped({ startImmediately: true }))

const layer = (daemon: { readonly options: PersistentPty.Options }) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionEnvironment.node,
      Session.node,
      Instance.node,
      LocationServiceMap.node,
      PersistentPty.node,
    ]),
    [
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      SessionModelTransport.node.replace(transport),
      PersistentPty.node.replace(PersistentPty.configured(daemon.options)),
      offlineModels,
    ],
  )
