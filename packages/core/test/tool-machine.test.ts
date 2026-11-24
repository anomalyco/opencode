import { describe, expect } from "bun:test"
import { randomBytes } from "node:crypto"
import { Effect, Option, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Join } from "@opencode/core/machine/join"
import { Machines } from "@opencode/core/machine/machines"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { MachineTools } from "@opencode/core/tool/plugin/machine"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeWorker } from "./fixture/machine-worker"
import { testEffect } from "./lib/effect"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity, toolNodeReplacements } from "./lib/tool"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Tool.node, Machines.node]), toolNodeReplacements()))

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

/** Runs `tools.machine.list()` in Code Mode, the way the model reaches it. */
const list = (registry: Tool.Interface) =>
  executeTool(registry, {
    sessionID: Session.ID.make("ses_machine_tool_test"),
    ...toolIdentity,
    call: {
      type: "tool-call",
      id: "call-machine-list",
      name: "execute",
      input: { code: "return await tools.machine.list()" },
    },
  }).pipe(Effect.map((result) => JSON.parse(result.content?.[0]?.type === "text" ? result.content[0].text : "")))

describe("MachineTools", () => {
  it.effect("registers nothing while the flag is off", () =>
    Effect.gen(function* () {
      const registry = yield* setup("-machines")
      expect(yield* registry.list()).toEqual([])
      expect(yield* paths(registry)).toEqual([])
    }),
  )

  it.effect("is registered and returns an empty list while there are no machines", () =>
    Effect.gen(function* () {
      const registry = yield* setup("machines")
      expect(yield* paths(registry)).toEqual(["machine.list"])
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
})
