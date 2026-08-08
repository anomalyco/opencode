import { beforeEach, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeMemoryDriver } from "@opencode-ai/core/environment"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { WorkspaceTable } from "@opencode-ai/core/workspace/sql"
import { Database } from "@opencode-ai/core/database/database"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { ChildProcess } from "effect/unstable/process"
import { testEffect } from "./lib/effect"

const calls: Array<{ readonly operation: string; readonly binding?: WorkspaceDriver.Binding }> = []
const memory = makeMemoryDriver()

const driver = WorkspaceDriver.make({
  create: ({ workspaceID }) => {
    calls.push({ operation: "create" })
    return Effect.succeed({ binding: { workspaceID, generation: 0 } })
  },
  connect: ({ binding }) => {
    calls.push({ operation: "connect", binding })
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

const registryNode = makeGlobalNode({
  service: WorkspaceDriver.RegistryService,
  layer: Layer.succeed(
    WorkspaceDriver.RegistryService,
    WorkspaceDriver.RegistryService.of(WorkspaceDriver.registry({ fake: driver })),
  ),
  deps: [],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Workspace.configured({ idleThreshold: "5 minutes", pollInterval: "1 minute" })]),
    [[WorkspaceDriver.node, registryNode]],
  ),
)

beforeEach(() => calls.splice(0))

it.effect("persists the workspace lifecycle and reconnects after idle suspension", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const created = yield* workspace.create("fake")

    expect(created.id.startsWith("wrk_")).toBe(true)
    expect(created.binding).toEqual({ workspaceID: created.id, generation: 0 })

    const environment = yield* workspace.connect(created.id)
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect"])

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

    yield* Effect.scoped(environment.spawner.spawn(ChildProcess.make("wake"))).pipe(Effect.exit)
    expect(calls.map((call) => call.operation)).toEqual(["create", "connect", "suspendForIdle", "connect"])
    expect(calls.at(-1)?.binding).toEqual({ workspaceID: created.id, generation: 1, suspended: true })

    yield* workspace.destroy(created.id)
    expect(calls.at(-1)?.operation).toBe("destroy")
  }),
)

it.effect("roundtrips nullable bindings through the workspace table", () =>
  Effect.gen(function* () {
    const id = Workspace.ID.create()
    yield* Database.Service.use(({ db }) =>
      db.insert(WorkspaceTable).values({ id, provider: "fake", binding: null, created_at: 10, last_used_at: 20 }).run(),
    ).pipe(Effect.orDie)

    const row = yield* Database.Service.use(({ db }) => db.select().from(WorkspaceTable).get()).pipe(Effect.orDie)
    expect(row).toEqual({ id, provider: "fake", binding: null, created_at: 10, last_used_at: 20 })
  }),
)
