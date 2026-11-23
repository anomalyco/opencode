import { describe, expect } from "bun:test"
import os from "os"
import { posix } from "node:path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Global } from "@opencode/util/global"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { Instructions } from "@opencode/core/instructions/index"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionCwd } from "@opencode/core/session/cwd"
import { SessionCwdInstructions } from "@opencode/core/session/cwd-instructions"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { readInitial, readUpdate } from "./lib/instructions"

const directory = AbsolutePath.make("/project")
const temporary = os.tmpdir()
const bytes = (value: string) => new TextEncoder().encode(value)

const machine = (name: string) =>
  Environment.make(Environment.ID.make(name), Environment.makeMemoryDriver(), { path: posix })

/** A machine whose file reads fail while it is offline, to model a paired machine that drops. */
const flaky = (name: string) => {
  const memory = machine(name)
  const state = { offline: false }
  const environment: Environment.Interface = {
    ...memory,
    files: {
      ...memory.files,
      stat: (path) =>
        state.offline
          ? Effect.fail(new Environment.Failed({ path, cause: new Error("offline") }))
          : memory.files.stat(path),
    },
  }
  return { state, environment }
}

const at = (environment: Environment.Interface, absolute: string): SessionCwd.Resolved => ({
  absolute: AbsolutePath.make(absolute),
  environment,
})

const layer = (claude = true) =>
  AppNodeBuilder.build(LayerNode.group([Environment.node, InstructionBuiltIns.node, SessionCwdInstructions.node]), [
    Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location({ directory })))),
    Global.node.replace(Global.layerWith({ config: temporary, tmp: temporary })),
    InstructionDiscovery.node.replace(
      Layer.mock(InstructionDiscovery.Service, { project: true, global: true, claude }),
    ),
  ])

const it = testEffect(layer())
const withoutClaude = testEffect(layer(false))

/** What a step sees: the built-in environment block plus the working directory's instructions. */
const load = (cwd: SessionCwd.Resolved | undefined) =>
  Effect.gen(function* () {
    const builtins = yield* InstructionBuiltIns.Service
    const env = yield* Environment.Service
    const instructions = yield* SessionCwdInstructions.Service
    const environment = yield* builtins.load({ cwd: cwd && SessionCwd.describe(cwd, env.id) })
    return Instructions.combine([environment, yield* instructions.load(cwd)])
  })

describe("SessionCwdInstructions", () => {
  it.effect("adds nothing when the session has no cwd", () =>
    Effect.gen(function* () {
      const builtins = yield* InstructionBuiltIns.Service
      const baseline = yield* readInitial(yield* builtins.load())
      const loaded = yield* readInitial(yield* load(undefined))

      expect(loaded).toEqual(baseline)
      expect(loaded.values["core/cwd-instructions"]).toBeUndefined()
      expect(loaded.text).toContain(`  Working directory: ${directory}`)
      expect(loaded.text).toContain(`  Workspace root folder: ${directory}`)
    }),
  )

  it.effect("adds nothing when the cwd is this Location's own directory", () =>
    Effect.gen(function* () {
      const local = Environment.make(Environment.localID, Environment.makeMemoryDriver(), {
        hostsServer: true,
        path: posix,
      })
      yield* local.files.mkdir(directory)
      yield* local.files.write(`${directory}/AGENTS.md`, bytes("Local rules"))

      const builtins = yield* InstructionBuiltIns.Service
      const baseline = yield* readInitial(yield* builtins.load())
      const loaded = yield* readInitial(yield* load(at(local, directory)))

      expect(loaded).toEqual(baseline)
    }),
  )

  it.effect("reports a machine cwd and loads its AGENTS.md", () =>
    Effect.gen(function* () {
      const gpu = machine("gpu")
      yield* gpu.files.mkdir("/work/app")
      yield* gpu.files.write("/work/app/AGENTS.md", bytes("Use pnpm."))

      const loaded = yield* readInitial(yield* load(at(gpu, "/work/app")))

      expect(loaded.values["core/environment"]).toBe(
        [
          "<env>",
          "  Working directory: gpu:/work/app",
          "  Machine: gpu",
          "  Commands and relative paths run on gpu, not on this server.",
          "</env>",
        ].join("\n"),
      )
      expect(loaded.text).toContain("Instructions from: gpu:/work/app/AGENTS.md\nUse pnpm.")
    }),
  )

  it.effect("prefers AGENTS.md over CLAUDE.md and falls back to CLAUDE.md alone", () =>
    Effect.gen(function* () {
      const gpu = machine("gpu")
      yield* gpu.files.mkdir("/work/app")
      yield* gpu.files.write("/work/app/AGENTS.md", bytes("Agents rules"))
      yield* gpu.files.write("/work/app/CLAUDE.md", bytes("Claude rules"))

      const both = yield* readInitial(yield* load(at(gpu, "/work/app")))
      expect(both.text).toContain("Instructions from: gpu:/work/app/AGENTS.md\nAgents rules")
      expect(both.text).not.toContain("Claude rules")

      yield* gpu.files.remove("/work/app/AGENTS.md")
      const claude = yield* readInitial(yield* load(at(gpu, "/work/app")))
      expect(claude.text).toContain("Instructions from: gpu:/work/app/CLAUDE.md\nClaude rules")
    }),
  )

  withoutClaude.effect("reads only AGENTS.md when CLAUDE.md is not configured", () => {
    const gpu = machine("gpu")
    return Effect.gen(function* () {
      yield* gpu.files.mkdir("/work/app")
      yield* gpu.files.write("/work/app/CLAUDE.md", bytes("Claude rules"))

      const loaded = yield* readInitial(yield* load(at(gpu, "/work/app")))
      expect(loaded.values["core/cwd-instructions"]).toBeUndefined()
      expect(loaded.text).not.toContain("Claude rules")
    })
  })

  it.effect("reports a local cwd that is a different directory than the Location's", () =>
    Effect.gen(function* () {
      const local = Environment.make(Environment.localID, Environment.makeMemoryDriver(), {
        hostsServer: true,
        path: posix,
      })
      yield* local.files.mkdir("/elsewhere")
      yield* local.files.write("/elsewhere/AGENTS.md", bytes("Elsewhere rules"))

      const loaded = yield* readInitial(yield* load(at(local, "/elsewhere")))

      expect(loaded.text).toContain("  Working directory: /elsewhere")
      expect(loaded.text).toContain(`  Platform: ${process.platform}`)
      expect(loaded.text).not.toContain("Workspace root folder")
      expect(loaded.text).toContain("Instructions from: /elsewhere/AGENTS.md\nElsewhere rules")
    }),
  )

  it.effect("updates the environment and instructions when the cwd moves", () =>
    Effect.gen(function* () {
      const gpu = machine("gpu")
      yield* gpu.files.mkdir("/work/app")
      yield* gpu.files.mkdir("/work/other")
      yield* gpu.files.write("/work/app/AGENTS.md", bytes("App rules"))
      yield* gpu.files.write("/work/other/AGENTS.md", bytes("Other rules"))

      const initialized = yield* readInitial(yield* load(at(gpu, "/work/app")))
      const updated = yield* readUpdate(yield* load(at(gpu, "/work/other")), initialized)

      expect(updated.changed).toBe(true)
      expect(updated.text).toContain("The environment you are running in is now:")
      expect(updated.text).toContain("  Working directory: gpu:/work/other")
      expect(updated.text).toContain("Instructions from: gpu:/work/other/AGENTS.md\nOther rules")
    }),
  )

  it.effect("removes the previous instructions when the cwd moves somewhere without one", () =>
    Effect.gen(function* () {
      const gpu = machine("gpu")
      yield* gpu.files.mkdir("/work/app")
      yield* gpu.files.mkdir("/work/other")
      yield* gpu.files.write("/work/app/AGENTS.md", bytes("App rules"))

      const initialized = yield* readInitial(yield* load(at(gpu, "/work/app")))
      const updated = yield* readUpdate(yield* load(at(gpu, "/work/other")), initialized)

      expect(updated.values["core/cwd-instructions"]).toBeUndefined()
      expect(updated.text).toContain("The previous working directory instructions no longer apply.")
    }),
  )

  it.effect("skips a missing file and an offline machine without failing the step", () =>
    Effect.gen(function* () {
      const gpu = machine("gpu")
      yield* gpu.files.mkdir("/work/app")
      const missing = yield* readInitial(yield* load(at(gpu, "/work/app")))
      expect(missing.values["core/cwd-instructions"]).toBeUndefined()

      const remote = flaky("far")
      remote.state.offline = true
      const offline = yield* readInitial(yield* load(at(remote.environment, "/work/app")))
      expect(offline.values["core/cwd-instructions"]).toBeUndefined()
      expect(offline.text).toContain("  Working directory: far:/work/app")
    }),
  )

  it.effect("keeps the same instructions through a transient machine failure", () =>
    Effect.gen(function* () {
      const gpu = flaky("gpu")
      yield* gpu.environment.files.mkdir("/work/app")
      yield* gpu.environment.files.write("/work/app/AGENTS.md", bytes("App rules"))

      const initialized = yield* readInitial(yield* load(at(gpu.environment, "/work/app")))
      expect(initialized.text).toContain("Instructions from: gpu:/work/app/AGENTS.md\nApp rules")

      gpu.state.offline = true
      const unchanged = yield* readUpdate(yield* load(at(gpu.environment, "/work/app")), initialized)
      expect(unchanged).toEqual({ values: initialized.values, text: "", changed: false })
    }),
  )
})
