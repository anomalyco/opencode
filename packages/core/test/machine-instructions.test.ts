import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Environment } from "@opencode/core/environment/index"
import { Flag } from "@opencode/core/flag"
import { Instructions } from "@opencode/core/instructions/index"
import { MachineInstructions } from "@opencode/core/machine/instructions"
import { Machines } from "@opencode/core/machine/machines"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeWorker } from "./fixture/machine-worker"
import { it } from "./lib/effect"
import { readInitial, readUpdate } from "./lib/instructions"

const machine = (name: string) => new Machines.Info({ id: Environment.ID.make(name), online: false })

const flag = (overrides: string) => Flag.node.replace(Flag.testLayer([], { overrides }))

const layer = (overrides: string, list: () => Machines.Info[]) =>
  AppNodeBuilder.build(MachineInstructions.node, [
    flag(overrides),
    Machines.node.replace(Layer.mock(Machines.Service, { list: () => Effect.succeed(list()) })),
  ])

const load = Effect.gen(function* () {
  const instructions = yield* MachineInstructions.Service
  return yield* instructions.load()
})

// Stands in for the rest of a session's baseline.
const other = Instructions.make<string>({
  key: Instructions.Key.make("test/other"),
  codec: Schema.toCodecJson(Schema.String),
  read: Effect.succeed("Other guidance"),
  render: { initial: (text) => text, changed: (_, text) => text },
})

describe("MachineInstructions", () => {
  it.effect("adds nothing to a session while the flag is off", () =>
    Effect.gen(function* () {
      const instructions = yield* load
      expect(yield* Instructions.read(instructions)).toEqual([
        { key: Instructions.Key.make("core/machines"), value: Instructions.removed },
      ])

      const without = yield* readInitial(other)
      const combined = Instructions.combine([other, instructions])
      expect(yield* readInitial(combined)).toEqual(without)
      expect(yield* readUpdate(combined, without)).toEqual({ values: without.values, text: "", changed: false })
    }).pipe(Effect.provide(layer("-machines", () => [machine("gpu"), machine("pro")]))),
  )

  it.effect("adds nothing while there are no machines", () =>
    Effect.gen(function* () {
      const instructions = yield* load
      expect((yield* Instructions.read(instructions))[0]?.value).toBe(Instructions.removed)
      expect(yield* readInitial(instructions)).toEqual({ values: {}, text: "" })
    }).pipe(Effect.provide(layer("machines", () => []))),
  )

  it.effect("names the machines, sorted, with the first one in the example path", () =>
    Effect.gen(function* () {
      const initialized = yield* load.pipe(Effect.flatMap(readInitial))
      expect(initialized.values).toEqual({ "core/machines": ["box", "pro"] })
      expect(initialized.text).toBe(
        [
          "Other machines are available: box, pro.",
          "Name one in a path, as in box:/work/file, for the read, write, edit and patch tools, and as the shell tool's workdir to run a command there. A machine path must be absolute. grep and glob cannot search another machine yet. A machine may be offline; the tool says so when it is.",
        ].join("\n"),
      )
    }).pipe(Effect.provide(layer("machines", () => [machine("pro"), machine("box")]))),
  )

  it.effect("announces added and removed machines as deltas, then the removal of the last one", () => {
    let machines = [machine("gpu")]
    return Effect.gen(function* () {
      const initialized = yield* load.pipe(Effect.flatMap(readInitial))

      machines = [machine("gpu"), machine("pro")]
      const added = yield* readUpdate(yield* load, initialized)
      expect(added.text).toBe("New machines are available in addition to those previously listed:\npro")

      machines = [machine("pro")]
      const removed = yield* readUpdate(yield* load, added)
      expect(removed.text).toBe("The following machines are no longer available and must not be used: gpu.")
      expect(removed.values).toEqual({ "core/machines": ["pro"] })

      machines = []
      const instructions = yield* load
      expect((yield* Instructions.read(instructions))[0]?.value).toBe(Instructions.removed)
      expect(yield* readUpdate(instructions, removed)).toEqual({
        values: {},
        text: "Other machines are no longer available. Do not use any previously listed machine.",
        changed: true,
      })
    }).pipe(Effect.provide(layer("machines", () => machines)))
  })

  it.effect("lists the real machines and appends nothing when one connects or its connection is lost", () =>
    Effect.gen(function* () {
      const machines = yield* Machines.Service
      const pro = yield* machines.add("pro")
      const id = yield* machines.add("gpu")
      const initialized = yield* load.pipe(Effect.flatMap(readInitial))
      expect(initialized.text).toBe(
        [
          "Other machines are available: gpu, pro.",
          "Name one in a path, as in gpu:/work/file, for the read, write, edit and patch tools, and as the shell tool's workdir to run a command there. A machine path must be absolute. grep and glob cannot search another machine yet. A machine may be offline; the tool says so when it is.",
        ].join("\n"),
      )
      const unchanged = { values: initialized.values, text: "", changed: false }

      const worker = yield* makeWorker({ environment: { id }, connect: machines.connect })
      yield* worker.restore
      expect(yield* machines.list()).toEqual([
        new Machines.Info({ id, online: true, os: "linux", arch: "x64" }),
        new Machines.Info({ id: pro, online: false }),
      ])
      expect(yield* readUpdate(yield* load, initialized)).toEqual(unchanged)

      yield* worker.cut
      expect(yield* machines.list()).toEqual([
        new Machines.Info({ id, online: false }),
        new Machines.Info({ id: pro, online: false }),
      ])
      expect(yield* readUpdate(yield* load, initialized)).toEqual(unchanged)
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([Database.node, Machines.node, MachineInstructions.node]), [
          flag("machines"),
        ]),
      ),
    ),
  )
})
