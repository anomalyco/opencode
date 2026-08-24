import { beforeEach, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { makeMemoryDriver } from "@opencode-ai/core/environment/index"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { WorkspaceTable } from "@opencode-ai/core/workspace/sql"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { ChildProcess } from "effect/unstable/process"
import { testEffect } from "./lib/effect"

const calls: Array<{ readonly operation: string; readonly binding?: WorkspaceDriver.Binding | null }> = []
const memory = makeMemoryDriver()
let failConnect = false
let create: WorkspaceDriver.Interface["create"] = ({ workspaceID }) =>
  Effect.succeed({ binding: { workspaceID, generation: 0 } })

const driver = WorkspaceDriver.make({
  create: (input) => {
    calls.push({ operation: "create" })
    return create(input)
  },
  connect: ({ binding }) => {
    calls.push({ operation: "connect", binding })
    if (failConnect) return Effect.fail(new WorkspaceDriver.Error({ message: "wake failed" }))
    return Effect.succeed(memory)
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
    [[WorkspaceDriver.node, WorkspaceDriver.registryNode({ fake: driver })]],
  ),
)

beforeEach(() => {
  calls.splice(0)
  failConnect = false
  create = ({ workspaceID }) => Effect.succeed({ binding: { workspaceID, generation: 0 } })
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
    const workspaceID = yield* workspace.create("fake")

    expect(workspaceID.startsWith("wrk_")).toBe(true)
    expect(calls).toEqual([])
    expect(
      yield* Database.Service.use(({ db }) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get(),
      ).pipe(Effect.orDie),
    ).toMatchObject({ id: workspaceID, provider: "fake", binding: null })
  }),
)

it.effect("destroys an unprovisioned workspace through the driver with a null binding", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create("fake")

    expect(yield* workspace.destroy(workspaceID)).toEqual({ destroyed: true })
    expect(calls).toEqual([{ operation: "destroy", binding: null }])
    expect(
      yield* Database.Service.use(({ db }) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get(),
      ).pipe(Effect.orDie),
    ).toBeUndefined()
  }),
)

it.effect("succeeds without calling the driver when the workspace does not exist", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = Workspace.ID.create()

    expect(yield* workspace.destroy(workspaceID)).toEqual({ destroyed: false })
    expect(calls).toEqual([])
  }),
)

it.effect("reports whether destroy removed an existing workspace", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create("fake")

    expect(yield* workspace.destroy(workspaceID)).toEqual({ destroyed: true })
    expect(yield* workspace.destroy(workspaceID)).toEqual({ destroyed: false })
    expect(calls).toEqual([{ operation: "destroy", binding: null }])
  }),
)

it.effect("starts eager provisioning in the background and lets callers join it", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create("fake")
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
    const workspaceID = yield* workspace.create("fake")
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
    const workspaceID = yield* workspace.create("fake")
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
    const workspaceID = yield* workspace.create("fake")
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
    const workspaceID = yield* workspace.create("fake")
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
    const workspaceID = yield* workspace.create("fake")
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
    const workspaceID = yield* workspace.create("fake")
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
    const created = yield* workspace.provision(yield* workspace.create("fake"))
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
