import { beforeEach, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { sqliteLayer } from "@opencode/core/database/sqlite.workerd"
import { Failed, makeFiles, makeMemoryDriver, NotFound } from "@opencode/core/environment/index"
import { Identity } from "@opencode/core/machine/identity"
import { Workspace } from "@opencode/core/workspace"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { WorkspaceTable } from "@opencode/core/workspace/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber, Layer, Sink, Stream } from "effect"
import { TestClock } from "effect/testing"
import { ChildProcess } from "effect/process"
import { ExitCode, make as makeSpawner, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"
import { testEffect } from "./lib/effect"

const calls: Array<{ readonly operation: string; readonly binding?: WorkspaceDriver.Binding | null }> = []
const memory = makeMemoryDriver()
let failConnect = false
let create: WorkspaceDriver.Interface["create"] = ({ workspaceID }) =>
  Effect.succeed({ binding: { workspaceID, generation: 0 } })
let connectDriver: WorkspaceDriver.Interface["connect"] = () => Effect.succeed(memory)

const driver = WorkspaceDriver.make({
  create: (input) => {
    calls.push({ operation: "create" })
    return create(input)
  },
  connect: (input) => {
    calls.push({ operation: "connect", binding: input.binding })
    if (failConnect) return Effect.fail(new WorkspaceDriver.Error({ message: "wake failed" }))
    return connectDriver(input)
  },
  suspendForIdle: ({ binding, saveBinding }) => {
    calls.push({ operation: "suspendForIdle", binding })
    return saveBinding({ ...binding, generation: Number(binding.generation) + 1, suspended: true })
  },
  destroy: ({ binding }) => {
    calls.push({ operation: "destroy", binding })
    return Effect.void
  },
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Workspace.configured({ idleThreshold: "5 minutes", pollInterval: "1 minute" })]),
    [WorkspaceDriver.node.replace(WorkspaceDriver.registryNode({ fake: driver, other: driver }))],
  ),
)

beforeEach(() => {
  calls.splice(0)
  failConnect = false
  create = ({ workspaceID }) => Effect.succeed({ binding: { workspaceID, generation: 0 } })
  connectDriver = () => Effect.succeed(memory)
})

const gateCreate = Effect.fnUntraced(function* () {
  const started = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  create = ({ workspaceID }) =>
    Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.as({ binding: { workspaceID, generation: 0 } }),
    )
  return { started, release }
})

it.effect("rejects unregistered workspace providers", () =>
  Effect.gen(function* () {
    const registry = WorkspaceDriver.registry({ fake: driver })

    for (const provider of ["missing", "constructor", "toString", "__proto__"]) {
      expect(yield* registry.get(provider).pipe(Effect.flip)).toEqual(
        new WorkspaceDriver.ProviderNotFound({ provider }),
      )
    }
  }),
)

it.effect("creates and persists an ID without provisioning", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })

    expect(workspaceID.startsWith("wrk_")).toBe(true)
    expect(calls).toEqual([])
    expect(
      yield* Database.Service.use(({ db }) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get(),
      ).pipe(Effect.orDie),
    ).toMatchObject({ id: workspaceID, provider: "fake", binding: null })
  }),
)

it.effect("reuses a caller-supplied ID with the same provider", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const id = Workspace.ID.create()

    expect(yield* workspace.create({ id, provider: "fake" })).toBe(id)
    expect(yield* workspace.create({ id, provider: "fake" })).toBe(id)
    expect(
      yield* Database.Service.use(({ db }) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).all(),
      ).pipe(Effect.orDie),
    ).toHaveLength(1)
    expect(calls).toEqual([])
  }),
)

it.effect("rejects a caller-supplied ID already assigned to another provider", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const id = Workspace.ID.create()
    yield* workspace.create({ id, provider: "fake" })

    expect(yield* workspace.create({ id, provider: "other" }).pipe(Effect.flip)).toEqual(
      new Workspace.CreateConflict({ workspaceID: id, provider: "other", existingProvider: "fake" }),
    )
  }),
)

it.effect("resolves an existing caller-supplied ID before provider lookup", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const id = Workspace.ID.create()
    yield* Database.Service.use(({ db }) =>
      db
        .insert(WorkspaceTable)
        .values({ id, provider: "missing", binding: null, created_at: 0, last_used_at: 0 })
        .run(),
    ).pipe(Effect.orDie)

    expect(yield* workspace.create({ id, provider: "missing" })).toBe(id)
    expect(yield* workspace.create({ id, provider: "another-missing" }).pipe(Effect.flip)).toEqual(
      new Workspace.CreateConflict({
        workspaceID: id,
        provider: "another-missing",
        existingProvider: "missing",
      }),
    )
  }),
)

it.effect("reports whether destroy removed an existing workspace", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })

    expect(yield* workspace.destroy(workspaceID)).toEqual({ destroyed: true })
    expect(yield* workspace.destroy(workspaceID)).toEqual({ destroyed: false })
    expect(calls).toEqual([{ operation: "destroy", binding: null }])
  }),
)

it.effect("starts eager provisioning in the background and lets callers join it", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const gate = yield* gateCreate()

    const eager = yield* workspace.provision(workspaceID).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(gate.started)
    const waiter = yield* workspace.provision(workspaceID).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Effect.yieldNow
    expect(calls.map((call) => call.operation)).toEqual(["create"])

    yield* Deferred.succeed(gate.release, undefined)
    const [eagerResult, waiterResult] = yield* Effect.all([Fiber.join(eager), Fiber.join(waiter)])
    expect(eagerResult).toEqual(waiterResult)
    expect(eagerResult.binding).toEqual({ workspaceID, generation: 0 })
  }),
)

it.effect("starts lazy provisioning on the first spawn", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const environment = yield* workspace.connect(workspaceID)
    const gate = yield* gateCreate()

    expect(calls).toEqual([])
    const spawned = yield* Effect.scoped(environment.spawner.spawn(ChildProcess.make("lazy"))).pipe(
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Deferred.await(gate.started)
    expect(calls.map((call) => call.operation)).toEqual(["create"])
    yield* Deferred.succeed(gate.release, undefined)
    yield* Fiber.await(spawned)
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])
  }),
)

it.effect("shares provisioning between concurrent first spawns", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const environment = yield* workspace.connect(workspaceID)
    const gate = yield* gateCreate()

    const spawned = yield* Effect.all(
      ["first", "second"].map((command) =>
        Effect.scoped(environment.spawner.spawn(ChildProcess.make(command))).pipe(
          Effect.forkScoped({ startImmediately: true }),
        ),
      ),
    )
    yield* Deferred.await(gate.started)
    yield* Effect.yieldNow
    expect(calls.map((call) => call.operation)).toEqual(["create"])

    yield* Deferred.succeed(gate.release, undefined)
    yield* Effect.forEach(spawned, Fiber.await)
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])
  }),
)

it.effect("keeps shared provisioning alive when a waiter is interrupted", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const gate = yield* gateCreate()

    const owner = yield* workspace.provision(workspaceID).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(gate.started)
    const waiter = yield* workspace.provision(workspaceID).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Fiber.interrupt(waiter)
    expect(calls.map((call) => call.operation)).toEqual(["create"])

    yield* Deferred.succeed(gate.release, undefined)
    expect((yield* Fiber.join(owner)).binding).toEqual({ workspaceID, generation: 0 })
    expect(calls.map((call) => call.operation)).toEqual(["create"])
  }),
)

it.effect("interrupts in-flight provisioning on destroy and fails waiters with NotFound", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const gate = yield* gateCreate()

    const waiter = yield* workspace.provision(workspaceID).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(gate.started)
    yield* workspace.destroy(workspaceID)

    expect(yield* Fiber.join(waiter).pipe(Effect.flip)).toEqual(new Workspace.NotFound({ workspaceID }))
    expect(calls.map((call) => call.operation)).toEqual(["create", "destroy"])
    expect(calls.at(-1)?.binding).toBeNull()
    expect(
      yield* Database.Service.use(({ db }) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get(),
      ).pipe(Effect.orDie),
    ).toBeUndefined()
  }),
)

it.effect("shares a failed attempt and retries the same workspace ID", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let fail = true
    create = ({ workspaceID }) =>
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(
          Effect.suspend(() =>
            fail
              ? Effect.fail(new WorkspaceDriver.Error({ message: "create failed" }))
              : Effect.succeed({ binding: { workspaceID, generation: 0 } }),
          ),
        ),
      )

    const first = yield* workspace.provision(workspaceID).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(started)
    const second = yield* workspace.provision(workspaceID).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.succeed(release, undefined)
    const [firstExit, secondExit] = yield* Effect.all([Fiber.await(first), Fiber.await(second)])
    expect(firstExit._tag).toBe("Failure")
    expect(secondExit._tag).toBe("Failure")
    expect(calls.map((call) => call.operation)).toEqual(["create"])

    fail = false
    expect((yield* workspace.provision(workspaceID)).binding).toEqual({ workspaceID, generation: 0 })
    expect(calls.map((call) => call.operation)).toEqual(["create", "create"])
  }),
)

it.effect("persists the workspace lifecycle and reconnects after idle suspension", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const created = yield* workspace.provision(workspaceID)

    expect(created.id).toBe(workspaceID)
    expect(created.binding).toEqual({ workspaceID: created.id, generation: 0 })

    const environment = yield* workspace.connect(created.id)
    expect(calls.map((call) => call.operation)).toEqual(["create"])

    yield* TestClock.adjust("4 minutes")
    yield* Effect.scoped(environment.spawner.spawn(ChildProcess.make("activity"))).pipe(Effect.exit)
    yield* TestClock.adjust("4 minutes")
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])

    yield* TestClock.adjust("2 minutes")
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect", "suspendForIdle"])

    const stored = yield* Database.Service.use(({ db }) =>
      db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, created.id)).get(),
    ).pipe(Effect.orDie)
    expect(stored?.binding).toEqual({ workspaceID: created.id, generation: 1, suspended: true })
    expect(stored?.last_used_at).toBe(4 * 60 * 1000)

    yield* Effect.scoped(environment.spawner.spawn(ChildProcess.make("wake"))).pipe(Effect.exit)
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect", "suspendForIdle", "connect"])
    expect(calls.at(-1)?.binding).toEqual({ workspaceID: created.id, generation: 1, suspended: true })

    yield* workspace.destroy(created.id)
    expect(calls.at(-1)?.operation).toBe("destroy")
  }),
)

it.effect("surfaces wake failures through the spawn error channel", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const created = yield* workspace.provision(yield* workspace.create({ provider: "fake" }))
    const environment = yield* workspace.connect(created.id)
    yield* Effect.scoped(environment.spawner.spawn(ChildProcess.make("connect"))).pipe(Effect.exit)

    yield* TestClock.adjust("6 minutes")
    failConnect = true

    const error = yield* Effect.scoped(environment.spawner.spawn(ChildProcess.make("wake"))).pipe(Effect.flip)
    expect(error).toMatchObject({
      _tag: "PlatformError",
      reason: {
        _tag: "Unknown",
        module: "Workspace",
        method: "spawn",
        description: `Failed to wake workspace ${created.id}`,
      },
    })
  }),
)

it.effect("routes file overrides through the workspace connection without spawning processes", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const files = makeFiles(yield* workspace.connect(workspaceID))

    expect(calls).toEqual([])
    const root = `/override-${workspaceID}`
    const payload = new TextEncoder().encode("hello workspace")

    yield* files.mkdir(root)
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])

    yield* files.write(`${root}/note.txt`, payload)
    expect(yield* files.stat(`${root}/note.txt`)).toMatchObject({
      type: "file",
      size: payload.byteLength,
    })
    expect((yield* files.read(`${root}/note.txt`, { offset: 0, length: 5 })).bytes).toEqual(
      new TextEncoder().encode("hello"),
    )
    expect(yield* files.list(root)).toEqual([{ name: "note.txt", type: "file" }])

    yield* files.move(`${root}/note.txt`, `${root}/renamed.txt`)
    expect(yield* files.list(root)).toEqual([{ name: "renamed.txt", type: "file" }])

    yield* files.remove(root)
    expect(yield* files.stat(root).pipe(Effect.flip)).toEqual(new NotFound({ path: root }))
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])
  }),
)

it.effect("falls back to execDefaults over the connection spawner for unprovided overrides", () =>
  Effect.gen(function* () {
    const spawned: string[] = []
    const written: Array<{ readonly path: string; readonly size: number }> = []
    const spawner = makeSpawner((command) =>
      Effect.sync(() => {
        if (command._tag === "StandardCommand") {
          spawned.push(String(command.args.at(3) ?? command.command))
        }
        return makeHandle({
          pid: ProcessId(1),
          exitCode: Effect.succeed(ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        })
      }),
    )
    connectDriver = () =>
      Effect.succeed({
        spawner,
        overrides: {
          write: (path, bytes) =>
            Effect.sync(() => {
              written.push({ path, size: bytes.byteLength })
            }),
        },
      })

    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const files = makeFiles(yield* workspace.connect(workspaceID))

    yield* files.write("/workspace/direct.txt", new Uint8Array([1, 2, 3]))
    expect(written).toEqual([{ path: "/workspace/direct.txt", size: 3 }])
    expect(spawned).toEqual([])
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])

    yield* files.mkdir("/workspace/sub")
    yield* files.remove("/workspace/direct.txt")
    expect(spawned).toEqual(["/workspace/sub", "/workspace/direct.txt"])
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])
  }),
)

it.effect("tracks active operations and lastActivity across file overrides", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    connectDriver = () =>
      Effect.succeed({
        spawner: memory.spawner,
        overrides: {
          ...memory.overrides,
          read: (path) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as({
                info: { type: "file" as const, size: 2, mtimeMs: 0 },
                bytes: new Uint8Array([1, 2]),
              }),
            ),
        },
      })

    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "fake" })
    const files = makeFiles(yield* workspace.connect(workspaceID))

    const reading = yield* files.read("/workspace/in-flight.txt").pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(started)

    yield* TestClock.adjust("6 minutes")
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])

    yield* Deferred.succeed(release, undefined)
    expect((yield* Fiber.join(reading)).bytes).toEqual(new Uint8Array([1, 2]))

    yield* TestClock.adjust("4 minutes")
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])

    yield* TestClock.adjust("2 minutes")
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect", "suspendForIdle"])

    const stored = yield* Database.Service.use(({ db }) =>
      db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get(),
    ).pipe(Effect.orDie)
    expect(stored?.last_used_at).toBe(6 * 60 * 1000)
  }),
)

it.effect("surfaces wake failures during file overrides as Environment.Failed", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const created = yield* workspace.provision(yield* workspace.create({ provider: "fake" }))
    const files = makeFiles(yield* workspace.connect(created.id))
    yield* files.mkdir("/warm")

    yield* TestClock.adjust("6 minutes")
    failConnect = true

    const readError = yield* files.read("/target.txt").pipe(Effect.flip)
    expect(readError).toEqual(
      new Failed({
        path: "/target.txt",
        cause: new WorkspaceDriver.Error({ message: "wake failed" }),
      }),
    )

    const moveError = yield* files.move("/from.txt", "/to.txt").pipe(Effect.flip)
    expect(moveError).toEqual(
      new Failed({
        path: "/from.txt",
        cause: new WorkspaceDriver.Error({ message: "wake failed" }),
      }),
    )
  }),
)

it.effect(
  "attaches an existing binding without calling create, clears stale idle deadlines on re-attach, and rejects conflicts",
  () =>
    Effect.gen(function* () {
      const workspace = yield* Workspace.Service
      const missing = yield* workspace.attach({ provider: "missing", binding: { host: "vm-1" } }).pipe(Effect.flip)
      expect(missing).toEqual(new WorkspaceDriver.ProviderNotFound({ provider: "missing" }))

      const id = yield* workspace.attach({ provider: "fake", binding: { host: "vm-1", generation: 0 } })
      expect(calls).toEqual([])

      const files = makeFiles(yield* workspace.connect(id))
      yield* files.mkdir(`/attached-${id}`)
      expect(calls).toEqual([{ operation: "connect", binding: { host: "vm-1", generation: 0 } }])
      expect(yield* workspace.connected(id)).toBe(true)

      // Advance partway toward idle, then re-attach: the old deadline must not suspend the newly attached binding.
      yield* TestClock.adjust("4 minutes")
      yield* workspace.attach({ id, provider: "fake", binding: { host: "vm-2", generation: 1 } })
      expect(yield* workspace.connected(id)).toBe(false)
      yield* TestClock.adjust("2 minutes")
      expect(calls.map((call) => call.operation)).toEqual(["connect"])

      yield* files.stat(`/attached-${id}`)
      expect(calls.at(-1)).toEqual({ operation: "connect", binding: { host: "vm-2", generation: 1 } })

      const conflict = yield* workspace.attach({ id, provider: "other", binding: { host: "vm-3" } }).pipe(Effect.flip)
      expect(conflict).toEqual(
        new Workspace.CreateConflict({ workspaceID: id, provider: "other", existingProvider: "fake" }),
      )
    }),
)

const bareIt = testEffect(Layer.empty)

const makeGate = Effect.fnUntraced(function* () {
  const started = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  return {
    started,
    release,
    wait: Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
  }
})

const gatedReadDriver = (wait: Effect.Effect<void>, byte = 1) => ({
  spawner: memory.spawner,
  overrides: {
    ...memory.overrides,
    read: () =>
      Effect.as(wait, {
        info: { type: "file" as const, size: 1, mtimeMs: 0 },
        bytes: new Uint8Array([byte]),
      }),
  },
})

const makeAlarmHarness = (
  options: {
    readonly keepWarm?: Workspace.Options["keepWarm"]
    readonly pollInterval?: Workspace.Options["pollInterval"]
    readonly create?: WorkspaceDriver.Interface["create"]
    readonly connect?: WorkspaceDriver.Interface["connect"]
    readonly close?: Effect.Effect<void>
    readonly suspendForIdle?: WorkspaceDriver.Interface["suspendForIdle"]
  } = {},
) => {
  const sharedDb = Database.configuredClient(sqliteLayer({ storage: makeDurableObjectStorage() }))
  const alarms: number[] = []
  const suspended: Workspace.ID[] = []
  const bindings: WorkspaceDriver.Binding[] = []
  const state = { openCount: 0, closeCount: 0, failSuspend: false }

  const alarmDriver = WorkspaceDriver.make({
    create: (input) =>
      options.create
        ? options.create(input)
        : Effect.succeed({ binding: { workspaceID: input.workspaceID, generation: 0 } }),
    connect: (input) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          state.openCount += 1
          bindings.push(input.binding)
        }).pipe(Effect.andThen(options.connect ? options.connect(input) : Effect.succeed(memory))),
        () => Effect.sync(() => void (state.closeCount += 1)).pipe(Effect.andThen(options.close ?? Effect.void)),
      ),
    suspendForIdle: (input) =>
      state.failSuspend
        ? Effect.fail(new WorkspaceDriver.Error({ message: "provider timeout" }))
        : Effect.sync(() => void suspended.push(input.workspaceID)).pipe(
            Effect.andThen(options.suspendForIdle ? options.suspendForIdle(input) : Effect.void),
          ),
    destroy: () => Effect.void,
  })

  const build = () =>
    AppNodeBuilder.build(
      Workspace.configured({
        idleThreshold: "5 minutes",
        keepWarm: options.keepWarm ?? 0,
        pollInterval: options.pollInterval === undefined ? null : options.pollInterval,
        onIdleScheduled: (atMs) => Effect.sync(() => void alarms.push(atMs)),
      }),
      [
        Database.node.replace(sharedDb),
        Identity.node.replace(Identity.kvNode),
        WorkspaceDriver.node.replace(WorkspaceDriver.registryNode({ fake: alarmDriver })),
      ],
    )

  return {
    alarms,
    suspended,
    bindings,
    state,
    counts: () => ({ openCount: state.openCount, closeCount: state.closeCount }),
    run: <A, E, R>(fn: (workspace: Workspace.Interface) => Effect.Effect<A, E, R>) =>
      Workspace.Service.use(fn).pipe(Effect.provide(build())),
  }
}

bareIt.effect("re-provisions when a warm connection is destroyed and recreated before acquisition", () =>
  Effect.gen(function* () {
    const gate = yield* makeGate()
    const harness = makeAlarmHarness({ keepWarm: "5 minutes", suspendForIdle: () => gate.wait })

    yield* harness.run((workspace) =>
      Effect.gen(function* () {
        const id = yield* workspace.attach({ provider: "fake", binding: { name: "old" } })
        const files = makeFiles(yield* workspace.connect(id))
        yield* files.mkdir("/before-race")
        yield* TestClock.adjust("6 minutes")

        const idle = yield* workspace.suspendIdle().pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(gate.started)
        const recreate = yield* workspace
          .destroy(id)
          .pipe(
            Effect.andThen(workspace.create({ id, provider: "fake" })),
            Effect.forkScoped({ startImmediately: true }),
          )
        // The idle driver still holds the lock and the warm connection is still cached.
        expect(yield* workspace.connected(id)).toBe(true)
        const op = yield* files.mkdir("/after-race").pipe(Effect.forkScoped({ startImmediately: true }))

        yield* Deferred.succeed(gate.release, undefined)
        yield* Fiber.join(idle)
        expect(yield* Fiber.join(recreate)).toBe(id)
        yield* Fiber.join(op)
        expect(harness.bindings).toEqual([{ name: "old" }, { workspaceID: id, generation: 0 }])
        expect(harness.counts()).toEqual({ openCount: 2, closeCount: 1 })
      }),
    )
    expect(harness.counts()).toEqual({ openCount: 2, closeCount: 2 })
  }),
)

bareIt.effect("returns NotFound when a warm connection is destroyed before acquisition", () =>
  Effect.gen(function* () {
    const gate = yield* makeGate()
    const harness = makeAlarmHarness({ keepWarm: "5 minutes", suspendForIdle: () => gate.wait })

    yield* harness.run((workspace) =>
      Effect.gen(function* () {
        const id = yield* workspace.attach({ provider: "fake", binding: { name: "deleted" } })
        const files = makeFiles(yield* workspace.connect(id))
        yield* files.mkdir("/before-delete")
        yield* TestClock.adjust("6 minutes")

        const idle = yield* workspace.suspendIdle().pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(gate.started)
        const destroy = yield* workspace.destroy(id).pipe(Effect.forkScoped({ startImmediately: true }))
        expect(yield* workspace.connected(id)).toBe(true)
        const op = yield* files.mkdir("/after-delete").pipe(Effect.flip, Effect.forkScoped({ startImmediately: true }))

        yield* Deferred.succeed(gate.release, undefined)
        yield* Fiber.join(idle)
        expect(yield* Fiber.join(destroy)).toEqual({ destroyed: true })
        expect(yield* Fiber.join(op)).toEqual(
          new Failed({ path: "/after-delete", cause: new Workspace.NotFound({ workspaceID: id }) }),
        )
        expect(yield* workspace.exists(id)).toBe(false)
        expect(harness.counts()).toEqual({ openCount: 1, closeCount: 1 })
      }),
    )
    expect(harness.counts()).toEqual({ openCount: 1, closeCount: 1 })
  }),
)

bareIt.effect("keepWarm 0 serializes a new acquisition behind the last release without leaking scopes", () =>
  Effect.gen(function* () {
    const gate = yield* makeGate()
    const harness = makeAlarmHarness({ close: gate.wait })

    yield* harness.run((workspace) =>
      Effect.gen(function* () {
        const id = yield* workspace.attach({ provider: "fake", binding: { name: "closing" } })
        const files = makeFiles(yield* workspace.connect(id))
        const first = yield* files.mkdir("/first-close").pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(gate.started)

        const second = yield* files.mkdir("/second-close").pipe(Effect.forkScoped({ startImmediately: true }))
        expect(yield* workspace.connected(id)).toBe(false)
        expect(harness.counts()).toEqual({ openCount: 1, closeCount: 1 })

        yield* Deferred.succeed(gate.release, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(yield* workspace.connected(id)).toBe(false)
        expect(harness.counts()).toEqual({ openCount: 2, closeCount: 2 })
      }),
    )
    expect(harness.counts()).toEqual({ openCount: 2, closeCount: 2 })
  }),
)

bareIt.effect("keepWarm 0 shares a connection across overlapping ops and closes immediately on last release", () =>
  Effect.gen(function* () {
    const gate = yield* makeGate()
    const harness = makeAlarmHarness({ connect: () => Effect.succeed(gatedReadDriver(gate.wait, 9)) })

    yield* harness.run((workspace) =>
      Effect.gen(function* () {
        const id = yield* workspace.attach({ provider: "fake", binding: { name: "overlap" } })
        const files = makeFiles(yield* workspace.connect(id))

        yield* TestClock.adjust("1 minute")
        const op1 = yield* files.read("/overlap").pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(gate.started)
        expect(yield* workspace.connected(id)).toBe(true)

        yield* files.mkdir("/keepwarm-overlap")
        expect(harness.counts()).toEqual({ openCount: 1, closeCount: 0 })

        yield* Deferred.succeed(gate.release, undefined)
        yield* Fiber.join(op1)
        expect(yield* workspace.connected(id)).toBe(false)
        expect(harness.counts()).toEqual({ openCount: 1, closeCount: 1 })
        expect(harness.alarms.at(-1)).toBe(6 * 60 * 1000)
      }),
    )
  }),
)

bareIt.effect("pushes the alarm deadline forward when an active operation outlives idleThreshold", () =>
  Effect.gen(function* () {
    const gate = yield* makeGate()
    const harness = makeAlarmHarness({ connect: () => Effect.succeed(gatedReadDriver(gate.wait)) })

    yield* harness.run((workspace) =>
      Effect.gen(function* () {
        const id = yield* workspace.attach({ provider: "fake", binding: { name: "long-op" } })
        const files = makeFiles(yield* workspace.connect(id))

        const op = yield* files.read("/long").pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(gate.started)

        // Alarm fires while op is still running past idleThreshold (5m): must push deadline forward, not tight-loop.
        yield* TestClock.adjust("6 minutes")
        expect(yield* workspace.suspendIdle()).toEqual([])
        expect(harness.alarms.at(-1)).toBe(11 * 60 * 1000)

        yield* Deferred.succeed(gate.release, undefined)
        yield* Fiber.join(op)
      }),
    )
  }),
)

bareIt.effect("coalesces earliest alarm across workspaces, backs off failures, and suspends after restart", () =>
  Effect.gen(function* () {
    const harness = makeAlarmHarness()

    const ids = yield* harness.run((workspace) =>
      Effect.gen(function* () {
        const first = yield* workspace.attach({ provider: "fake", binding: { name: "a" } })
        const second = yield* workspace.attach({ provider: "fake", binding: { name: "b" } })
        const firstFiles = makeFiles(yield* workspace.connect(first))
        const secondFiles = makeFiles(yield* workspace.connect(second))

        yield* TestClock.adjust("1 minute")
        yield* firstFiles.mkdir("/alarm-a")
        expect(harness.alarms.at(-1)).toBe(6 * 60 * 1000)

        // Later workspace keeps earliest pending alarm (6m, not 8m).
        yield* TestClock.adjust("2 minutes")
        yield* secondFiles.mkdir("/alarm-b")
        expect(harness.alarms.at(-1)).toBe(6 * 60 * 1000)
        return { first, second }
      }),
    )

    // Fresh Workspace.Service over the same DB simulates DO eviction; pollInterval null means no automatic suspend.
    yield* harness.run((workspace) =>
      Effect.gen(function* () {
        yield* TestClock.adjust("3 minutes") // t = 6m
        expect(harness.suspended).toEqual([])

        harness.state.failSuspend = true
        expect(yield* workspace.suspendIdle()).toEqual([])
        expect(harness.alarms.at(-1)).toBe(8 * 60 * 1000)

        harness.state.failSuspend = false
        yield* TestClock.adjust("2 minutes") // t = 8m
        expect(yield* workspace.suspendIdle()).toEqual([ids.second])
        expect(harness.alarms.at(-1)).toBe(11 * 60 * 1000)

        yield* TestClock.adjust("3 minutes") // t = 11m
        expect(yield* workspace.suspendIdle()).toEqual([ids.first])
        expect(yield* workspace.suspendIdle()).toEqual([])
      }),
    )
  }),
)

bareIt.effect("closes warm connections past keepWarm before idleThreshold and clears deadlines on destroy", () =>
  Effect.gen(function* () {
    const harness = makeAlarmHarness({ keepWarm: "1 minute", pollInterval: "1 minute" })

    yield* harness.run((workspace) =>
      Effect.gen(function* () {
        const a = yield* workspace.attach({ provider: "fake", binding: { name: "warm" } })
        const b = yield* workspace.attach({ provider: "fake", binding: { name: "destroyed" } })
        yield* makeFiles(yield* workspace.connect(a)).mkdir("/warm-a")
        yield* TestClock.adjust("30 seconds")
        yield* makeFiles(yield* workspace.connect(b)).mkdir("/warm-b")

        // Destroying b removes its deadline cleanly.
        yield* workspace.destroy(b)

        // At t = 1m30s (1m30s after a's last activity), keepWarm (1m) closes a's connection without suspending yet.
        yield* TestClock.adjust("1 minute")
        expect(yield* workspace.connected(a)).toBe(false)
        expect(harness.suspended).toEqual([])

        // At t = 5m30s, idleThreshold (5m) suspends a only (not destroyed b).
        yield* TestClock.adjust("4 minutes")
        expect(harness.suspended).toEqual([a])
      }),
    )
  }),
)

bareIt.effect(
  "re-attaching during an active op lets it finish, closes the old scope on release, and routes new ops to the new binding",
  () =>
    Effect.gen(function* () {
      const gate = yield* makeGate()
      const harness = makeAlarmHarness({
        keepWarm: "5 minutes",
        connect: (input) =>
          Effect.succeed(
            gatedReadDriver(
              input.binding.host === "vm-1" ? gate.wait : Effect.void,
              input.binding.host === "vm-1" ? 1 : 9,
            ),
          ),
      })

      yield* harness.run((workspace) =>
        Effect.gen(function* () {
          const id = yield* workspace.attach({ provider: "fake", binding: { host: "vm-1" } })
          const files = makeFiles(yield* workspace.connect(id))

          const inFlight = yield* files.read("/old").pipe(Effect.forkScoped({ startImmediately: true }))
          yield* Deferred.await(gate.started)

          // Re-attach while old op is running: old scope stays open until it finishes, new ops hit vm-2 immediately.
          yield* workspace.attach({ id, provider: "fake", binding: { host: "vm-2" } })
          expect(harness.counts()).toEqual({ openCount: 1, closeCount: 0 })

          expect((yield* files.read("/new")).bytes).toEqual(new Uint8Array([9]))
          expect(harness.bindings).toEqual([{ host: "vm-1" }, { host: "vm-2" }])

          yield* Deferred.succeed(gate.release, undefined)
          expect((yield* Fiber.join(inFlight)).bytes).toEqual(new Uint8Array([1]))
          expect(harness.counts()).toEqual({ openCount: 2, closeCount: 1 })
        }),
      )
    }),
)

bareIt.effect(
  "provides persistent host Identity.Service to both WorkspaceDriver.create and WorkspaceDriver.connect",
  () =>
    Effect.gen(function* () {
      const keys: Uint8Array[] = []
      const seedErrors: Identity.InvalidKey[] = []
      const checkIdentity = Effect.gen(function* () {
        const identity = yield* Identity.Service
        keys.push(yield* identity.publicKey().pipe(Effect.orDie))
        seedErrors.push(yield* identity.seed().pipe(Effect.flip, Effect.orDie))
      })
      const harness = makeAlarmHarness({
        create: (input) => Effect.as(checkIdentity, { binding: { workspaceID: input.workspaceID } }),
        connect: () => Effect.as(checkIdentity, memory),
      })

      const workspaceID = yield* harness.run((workspace) =>
        Effect.gen(function* () {
          const id = yield* workspace.create({ provider: "fake" })
          yield* makeFiles(yield* workspace.connect(id)).mkdir("/identity-check")
          return id
        }),
      )

      // A fresh Workspace.Service over the same KV database sees the exact same 32-byte Ed25519 identity key.
      yield* harness.run((workspace) =>
        Effect.flatMap(workspace.connect(workspaceID), (driver) => makeFiles(driver).mkdir("/identity-check-2")),
      )

      expect(keys).toHaveLength(3)
      expect(keys[0]?.length).toBe(32)
      expect(keys[1]).toEqual(keys[0])
      expect(keys[2]).toEqual(keys[0])
      expect(seedErrors).toHaveLength(3)
      expect(seedErrors.every((err) => err instanceof Identity.InvalidKey)).toBe(true)
    }),
)
