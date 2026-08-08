import { beforeEach, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { makeMemoryDriver } from "@opencode-ai/core/environment"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { WorkspaceTable } from "@opencode-ai/core/workspace/sql"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { ChildProcess } from "effect/unstable/process"
import { testEffect } from "./lib/effect"

const calls: Array<{ readonly operation: string; readonly binding?: WorkspaceDriver.Binding }> = []
const memory = makeMemoryDriver()
let failConnect = false

const driver = WorkspaceDriver.make({
  create: ({ workspaceID }) => {
    calls.push({ operation: "create" })
    return Effect.succeed({ binding: { workspaceID, generation: 0 } })
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
})

it.effect("persists the workspace lifecycle and reconnects after idle suspension", () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const created = yield* workspace.create("fake")

    expect(created.id.startsWith("wrk_")).toBe(true)
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
    const created = yield* workspace.create("fake")
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
