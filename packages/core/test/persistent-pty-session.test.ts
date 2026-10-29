import { describe, expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
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
import { Removed } from "@opencode/schema/persistent-pty"
import { listen, pong, temporaryDirectory, terminal, writeRegistration } from "./fixture/persistent-pty-daemon"
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

const nextRemoved = (bus: Bus.Interface) =>
  bus.subscribe(Removed).pipe(Stream.runHead, Effect.map(Option.getOrThrow), Effect.forkScoped({ startImmediately: true }))

// An in-process opencode-pty that the layer adopts through a handoff, so no daemon is spawned.
const fakeDaemon = Effect.fn(function* () {
  const base = yield* temporaryDirectory()
  const root = path.join(base, "root")
  const directory = path.join(root, "inherited")
  const socket = path.join(base, "daemon.sock")
  const terminals: ReturnType<typeof terminal>[] = []
  const failTerminate = new Set<string>()
  let nextID = 1
  yield* listen(socket, (_socket, request) => {
    if (request.op === "ping") return pong
    if (request.op === "list") return { type: "terminals", terminals }
    if (request.op === "create") {
      const created = terminal(nextID++, String(request.group_id))
      terminals.push(created)
      return { type: "created", terminal: created }
    }
    if (request.op === "control") return { type: "ok" }
    if (request.op === "terminate") {
      if (failTerminate.has(`pty_persistent_${request.id}`)) return { type: "error", message: "terminate failed" }
      const index = terminals.findIndex((item) => item.id === request.id)
      if (index === -1) return { type: "error", message: `terminal not found: ${String(request.id)}` }
      terminals.splice(index, 1)
      return { type: "ok" }
    }
    return { type: "error", message: `unexpected request: ${String(request.op)}` }
  })
  yield* Effect.promise(async () => {
    await mkdir(directory, { recursive: true })
    await writeRegistration(directory, socket)
  })
  return {
    failTerminate,
    options: {
      root,
      handoff: { directory, instanceID: "test", ticket: "ticket", expiresAt: Date.now() + 60_000 },
    },
  }
})

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
