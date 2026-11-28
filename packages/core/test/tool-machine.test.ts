import { describe, expect } from "bun:test"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"
import { Effect, Layer, Option, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileWrite } from "@opencode/core/file-write"
import { Flag } from "@opencode/core/flag"
import { Join } from "@opencode/core/machine/join"
import { Location } from "@opencode/core/location"
import { Machines } from "@opencode/core/machine/machines"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { MachineTools } from "@opencode/core/tool/plugin/machine"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "./fixture/location"
import { permissionLayer } from "./lib/permission"
import { makePeers, makeWorker, type Peers } from "./fixture/machine-worker"
import { testEffect } from "./lib/effect"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity, toolNodeReplacements, toolNodes } from "./lib/tool"

/** Every approval the tools asked for, in order. */
const assertions: Permission.AssertInput[] = []
const graph = AppNodeBuilder.build(
  LayerNode.group([toolNodes, Machines.node, FileAccess.node, FileWrite.node, Permission.node]),
  [
    ...toolNodeReplacements(permissionLayer({ assert: (input) => Effect.sync(() => void assertions.push(input)) })),
    Location.node.replace(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(tmpdir()) }))),
    ),
  ],
)
const it = testEffect(graph)
// The file tools read machine paths only while the flag is on where they run.
const on = testEffect(Layer.succeed(Flag.Overrides, "machines"))

const setup = (overrides: string) =>
  Effect.gen(function* () {
    yield* registerToolPlugin(MachineTools.Plugin, { event: { subscribe: () => Stream.never } }).pipe(
      Effect.provide(Flag.testLayer([], { overrides })),
    )
    return yield* Tool.Service
  })

const paths = (registry: Tool.Interface) =>
  registry
    .snapshot()
    .pipe(
      Effect.map((snapshot) =>
        snapshot.codeModeCatalog ? codeModeListings(snapshot.codeModeCatalog).map((tool) => tool.path) : [],
      ),
    )

/** Runs `code` in Code Mode, the way the model reaches the machine tools, and returns its text. */
const run = (registry: Tool.Interface, code: string) =>
  executeTool(registry, {
    sessionID: Session.ID.make("ses_machine_tool_test"),
    ...toolIdentity,
    call: { type: "tool-call", id: "call-machine", name: "execute", input: { code } },
  }).pipe(Effect.map((result) => (result.content?.[0]?.type === "text" ? result.content[0].text : "")))

const list = (registry: Tool.Interface) =>
  run(registry, "return await tools.machine.list()").pipe(Effect.map((text) => JSON.parse(text)))

/** A paired, connected machine whose worker reaches the other fake workers through `peers`. */
const paired = (machines: Machines.Interface, name: string, peers: Peers) =>
  Effect.gen(function* () {
    const id = yield* machines.add(name)
    const invite = yield* machines.invite(id, { reach: [{ type: "url", url: "https://home.example" }] })
    yield* machines.join({ secret: Option.getOrThrow(Join.decode(invite)).secret, key: randomBytes(32) })
    const worker = yield* makeWorker({ connect: (connection) => machines.connect(id, connection) }, peers)
    yield* worker.restore
    return { id, worker, files: Environment.makeFiles(worker.files) }
  })

const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array) => new TextDecoder().decode(value)

describe("MachineTools", () => {
  it.effect("registers nothing while the flag is off", () =>
    Effect.gen(function* () {
      const registry = yield* setup("-machines")
      expect((yield* registry.list()).map((tool) => tool.id)).toEqual(["execute"])
      expect(yield* paths(registry)).toEqual([])
    }),
  )

  it.effect("is registered and returns an empty list while there are no machines", () =>
    Effect.gen(function* () {
      const registry = yield* setup("machines")
      expect(yield* paths(registry)).toEqual([
        "machine.copy",
        "machine.forward",
        "machine.list",
        "machine.move",
        "machine.unforward",
      ])
      expect(yield* list(registry)).toEqual({ machines: [] })
    }),
  )

  it.effect("lists a connected machine and one still waiting to join", () =>
    Effect.gen(function* () {
      const registry = yield* setup("machines")
      const machines = yield* Machines.Service
      const gpu = yield* machines.add("gpu")
      yield* machines.add("pro")
      const invite = yield* machines.invite(gpu, { reach: [{ type: "url", url: "https://home.example" }] })
      yield* machines.join({ secret: Option.getOrThrow(Join.decode(invite)).secret, key: randomBytes(32) })
      const worker = yield* makeWorker({ connect: (connection) => machines.connect(gpu, connection) })
      yield* worker.restore

      expect(yield* list(registry)).toEqual({
        machines: [
          { id: "gpu", online: true, paired: true, os: "linux", arch: "x64" },
          { id: "pro", online: false, paired: false },
        ],
      })
    }),
  )

  on.effect("copies and moves a file between two machines over their peer link", () =>
    Effect.gen(function* () {
      const registry = yield* setup("machines")
      const machines = yield* Machines.Service
      const peers = makePeers()
      const gpu = yield* paired(machines, "gpu", peers)
      const pro = yield* paired(machines, "pro", peers)
      yield* gpu.files.mkdir("/data")
      yield* pro.files.mkdir("/srv")
      yield* gpu.files.write("/data/a.bin", bytes("weights"))

      assertions.length = 0
      expect(
        yield* run(registry, `return await tools.machine.copy({ from: "gpu:/data/a.bin", to: "pro:/srv/a.bin" })`),
      ).toContain("pro:/srv/a.bin")
      expect(assertions.flatMap((input) => input.resources.map((resource) => `${input.action} ${resource}`))).toEqual([
        "external_directory gpu:/data/*",
        "external_directory pro:/srv/*",
        "read gpu:/data/a.bin",
        "edit pro:/srv/a.bin",
      ])
      expect(text((yield* pro.files.read("/srv/a.bin")).bytes)).toBe("weights")
      expect(text((yield* gpu.files.read("/data/a.bin")).bytes)).toBe("weights")
      // The receiver was told where to write before the sender was told to send.
      const receive = pro.worker.received.find((message) => message.type === "peer-receive")
      const send = gpu.worker.received.find((message) => message.type === "peer-send")
      expect(receive).toMatchObject({ path: "/srv/a.bin" })
      expect(send).toMatchObject({ path: "/data/a.bin", token: receive?.type === "peer-receive" ? receive.token : "" })

      assertions.length = 0
      yield* run(registry, `return await tools.machine.move({ from: "gpu:/data/a.bin", to: "pro:/srv/b.bin" })`)
      expect(assertions.map((input) => `${input.action} ${input.resources.join(" ")}`)).toContain(
        "edit gpu:/data/a.bin",
      )
      expect(text((yield* pro.files.read("/srv/b.bin")).bytes)).toBe("weights")
      expect(yield* gpu.files.stat("/data/a.bin").pipe(Effect.flip)).toBeInstanceOf(Environment.NotFound)
      // One link served both.
      expect(gpu.worker.received.filter((message) => message.type === "peer-connect")).toHaveLength(1)
    }).pipe(Effect.provide(graph)),
  )

  on.effect("maps a port on one machine to a port on another until unforwarded", () =>
    Effect.gen(function* () {
      const registry = yield* setup("machines")
      const machines = yield* Machines.Service
      const peers = makePeers()
      yield* paired(machines, "gpu", peers)
      yield* paired(machines, "pro", peers)

      const { id } = JSON.parse(
        yield* run(
          registry,
          `return await tools.machine.forward({ from: { machine: "pro", port: 3000 }, to: { machine: "gpu", port: 8000 } })`,
        ),
      )
      const [token] = [...peers.forwards.keys()]
      expect(peers.forwards.get(token)).toMatchObject({ port: 3000 })
      expect(peers.allows.get(token)).toMatchObject({ port: 8000 })

      expect(
        JSON.parse(yield* run(registry, `return await tools.machine.unforward({ id: ${JSON.stringify(id)} })`)),
      ).toEqual({
        removed: true,
      })
      expect(peers.forwards.size).toBe(0)
      expect(peers.allows.size).toBe(0)
    }).pipe(Effect.provide(graph)),
  )

  on.effect("refuses a copy with an end on this server", () =>
    Effect.gen(function* () {
      const registry = yield* setup("machines")
      const machines = yield* Machines.Service
      const gpu = yield* paired(machines, "gpu", makePeers())
      yield* gpu.files.write("/a.bin", bytes("x"))
      assertions.length = 0
      expect(
        yield* run(registry, `return await tools.machine.copy({ from: "gpu:/a.bin", to: "/tmp/a.bin" })`),
      ).toContain("Both paths must be on machines")
      expect(assertions).toEqual([])
    }).pipe(Effect.provide(graph)),
  )
})
