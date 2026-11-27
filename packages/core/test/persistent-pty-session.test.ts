import { describe, expect } from "bun:test"
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
import { Removed, Updated } from "@opencode/schema/persistent-pty"
import { Pty } from "@opencode/schema/pty"
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
      const daemon = yield* fakeDaemon()
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
})

const pipeInput = (cwd: string) => ({
  program: process.execPath,
  args: ["--version"],
  cwd,
  env: { TEST: "1" },
  groupID: "proj_test",
  outputPath: path.join(cwd, "sh_test.out"),
  metadata: { id: "sh_test", command: "--version" },
})

describe("PersistentPty pipe processes", () => {
  it.live("knows a handoff is prepared until a shutdown or until its ticket expires", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        const pty = yield* PersistentPty.Service
        expect(pty.handoffPrepared()).toBe(false)
        yield* pty.createPipe(pipeInput(daemon.options.root))
        expect(yield* pty.handoff()).not.toBeNull()
        expect(pty.handoffPrepared()).toBe(true)
        // Abandoned by a shutdown.
        yield* pty.shutdown()
        expect(pty.handoffPrepared()).toBe(false)
      }).pipe(Effect.provide(layer(daemon)))

      // Abandoned by letting the ticket expire.
      const expiring = yield* fakeDaemon()
      expiring.handoffTTL.ms = 50
      yield* Effect.gen(function* () {
        const pty = yield* PersistentPty.Service
        yield* pty.createPipe(pipeInput(expiring.options.root))
        expect(yield* pty.handoff()).not.toBeNull()
        expect(pty.handoffPrepared()).toBe(true)
        yield* Effect.sleep(80)
        expect(pty.handoffPrepared()).toBe(false)
      }).pipe(Effect.provide(layer(expiring)))
    }),
  )

  it.live("creates, inspects, signals and waits for a pipe process", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        const pty = yield* PersistentPty.Service
        const input = pipeInput(daemon.options.root)
        const created = yield* pty.createPipe(input)
        expect(daemon.requests.at(-1)).toEqual({
          op: "create_pipe",
          program: input.program,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
          group_id: "proj_test",
          output_path: input.outputPath,
          metadata: input.metadata,
        })
        expect(created).toMatchObject({
          groupID: "proj_test",
          outputPath: input.outputPath,
          lifecycle: { status: "running" },
          metadata: input.metadata,
          exitedAt: undefined,
        })

        yield* pty.setPipeMetadata(created.id, { id: "sh_test", status: "killed" })
        expect((yield* pty.getPipe(created.id)).metadata).toEqual({ id: "sh_test", status: "killed" })
        expect((yield* pty.listPipes()).map((item) => item.id)).toEqual([created.id])

        const waiting = yield* pty.waitPipe(created.id).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* pty.signalPipe(created.id, "SIGTERM")
        expect(yield* Fiber.join(waiting)).toMatchObject({ exitCode: undefined, signal: "SIGTERM", outputLines: 0 })
        // A finished process answers a later wait at once and keeps its record until it is terminated.
        expect((yield* pty.waitPipe(created.id)).signal).toBe("SIGTERM")
        expect((yield* pty.getPipe(created.id)).lifecycle).toEqual({
          status: "exited",
          exitCode: undefined,
          signal: "SIGTERM",
        })

        yield* pty.terminatePipe(created.id)
        expect(yield* Effect.flip(pty.getPipe(created.id))).toEqual(
          new PersistentPty.ProcessNotFoundError({ processID: created.id }),
        )
        expect(yield* pty.listPipes()).toEqual([])
      }).pipe(Effect.provide(layer(daemon)))
    }),
  )

  it.live("keeps pipe processes and terminals apart", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        const pty = yield* PersistentPty.Service
        const directory = yield* tmpdirScoped()
        const terminal = yield* pty.create(Session.ID.make("ses_pipe"), {
          args: [],
          cwd: directory.path,
          title: "test",
          env: {},
        })
        const pipe = yield* pty.createPipe(pipeInput(directory.path))

        expect((yield* pty.list()).map((item) => item.id)).toEqual([terminal.id])
        expect((yield* pty.listPipes()).map((item) => item.id)).toEqual([pipe.id])
        const ptyID = Pty.ID.make(`pty_persistent_${pipe.id}`)
        expect(yield* Effect.flip(pty.get(ptyID))).toEqual(new PersistentPty.NotFoundError({ ptyID }))
      }).pipe(Effect.provide(layer(daemon)))
    }),
  )

  it.live("reports daemon rejections as request errors and a terminated wait as one", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        const pty = yield* PersistentPty.Service
        const input = pipeInput(daemon.options.root)
        expect(yield* Effect.flip(pty.createPipe({ ...input, cwd: "relative" }))).toEqual(
          new PersistentPty.RequestError({ message: "cwd must be absolute" }),
        )
        const created = yield* pty.createPipe(input)
        const waiting = yield* pty.waitPipe(created.id).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* poll(() => daemon.waiters(created.id) === 1)
        yield* pty.terminatePipe(created.id)
        expect(yield* Fiber.join(waiting).pipe(Effect.flip)).toEqual(
          new PersistentPty.RequestError({ message: "terminated" }),
        )
      }).pipe(Effect.provide(layer(daemon)))
    }),
  )
})

const poll = (ready: () => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200 && !ready(); attempt++) yield* Effect.sleep(10)
    expect(ready()).toBeTrue()
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

describe("PersistentPty handoff", () => {
  it.live("prepares a handoff more than once on the same owner connection", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        const pty = yield* PersistentPty.Service
        yield* pty.createPipe(pipeInput(daemon.options.root))
        expect(yield* pty.handoff()).toMatchObject({ ticket: "next" })
        expect(yield* pty.handoff()).toMatchObject({ ticket: "next" })
      }).pipe(Effect.provide(layer(daemon)))
    }),
  )
})
