import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Environment } from "@opencode/core/environment/index"
import { Environments } from "@opencode/core/environments"
import { Location } from "@opencode/core/location"
import { Machine } from "@opencode/core/machine/index"
import { Machines } from "@opencode/core/machine/machines"
import { AbsolutePath } from "@opencode/core/schema"
import { Workspace } from "@opencode/core/workspace"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { location } from "./fixture/location"
import { makeWorker } from "./fixture/machine-worker"
import { testEffect } from "./lib/effect"

const memory = Environment.makeMemoryDriver()

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Environments.node, Machines.node, Workspace.node]), [
    WorkspaceDriver.node.replace(
      WorkspaceDriver.registryNode({
        memory: WorkspaceDriver.make({
          create: ({ workspaceID }) => Effect.succeed({ binding: { workspaceID } }),
          connect: () => Effect.succeed(memory),
          suspendForIdle: () => Effect.void,
          destroy: () => Effect.void,
        }),
      }),
    ),
  ]),
)

const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array) => new TextDecoder().decode(value)

/** The Environment a Location is bound to, through this test's registry. */
const bound = (workspaceID?: Workspace.ID) =>
  Effect.gen(function* () {
    const environments = yield* Environments.Service
    return yield* Environment.Service.use(Effect.succeed).pipe(
      Effect.provide(
        LayerNode.compile(Environment.node, {
          replacements: [
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make("/project"), workspaceID })),
              ),
            ),
            Environments.node.replace(Layer.succeed(Environments.Service, environments)),
          ],
        }),
      ),
    )
  })

it.effect("gets this server's own environment and home", () =>
  Effect.gen(function* () {
    const environments = yield* Environments.Service
    expect(yield* environments.get(Environment.localID)).toMatchObject({
      id: Environment.localID,
      hostsServer: true,
      searchable: true,
    })
    expect(yield* environments.home(Environment.localID)).toBe(Global.Path.home)
  }),
)

it.effect("gets a machine's environment, and its home only while it is online", () =>
  Effect.gen(function* () {
    const environments = yield* Environments.Service
    const machines = yield* Machines.Service
    const id = yield* machines.add("gpu")

    expect(yield* environments.get(id)).toBe(yield* machines.get(id))
    expect(yield* environments.home(id).pipe(Effect.flip)).toBeInstanceOf(Machine.NotSent)

    const worker = yield* makeWorker({ connect: (connection) => machines.connect(id, connection) })
    yield* worker.restore
    expect(yield* environments.home(id)).toBe("/home/worker")
  }),
)

it.effect("refuses a name that is no machine or workspace with the machine list's error", () =>
  Effect.gen(function* () {
    const environments = yield* Environments.Service
    const id = Environment.ID.make("cpu")

    expect(yield* environments.get(id).pipe(Effect.flip)).toEqual(new Machines.NotFound({ machine: id }))
    expect(yield* environments.home(id).pipe(Effect.flip)).toEqual(new Machines.NotFound({ machine: id }))
  }),
)

it.effect("gets a workspace's environment, which has no home here", () =>
  Effect.gen(function* () {
    const environments = yield* Environments.Service
    const workspace = yield* Workspace.Service
    const id = Environment.ID.make(yield* workspace.create({ provider: "memory" }))

    const environment = yield* environments.get(id)
    expect(environment).toMatchObject({ id, searchable: true })
    expect(environment.hostsServer).toBeUndefined()
    yield* environment.files.write("/notes.txt", bytes("workspace\n"))
    expect(text((yield* Environment.makeFiles(memory).read("/notes.txt")).bytes)).toBe("workspace\n")

    expect(yield* environments.home(id).pipe(Effect.flip)).toBeInstanceOf(Machines.NotFound)
  }),
)

it.effect("binds a Location to this server or to its workspace through the registry", () =>
  Effect.gen(function* () {
    const environments = yield* Environments.Service
    expect(yield* bound()).toBe(yield* environments.get(Environment.localID))

    const workspace = yield* Workspace.Service
    const workspaceID = yield* workspace.create({ provider: "memory" })
    const environment = yield* bound(workspaceID)
    expect(environment).toMatchObject({ id: Environment.ID.make(workspaceID), searchable: true })
    expect(environment.hostsServer).toBeUndefined()
  }),
)
