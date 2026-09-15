import { describe, expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Config } from "@opencode-ai/core/config"
import { Shell } from "@opencode-ai/core/shell"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextBuiltIns } from "@opencode-ai/core/system-context/builtins"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"

const directory = AbsolutePath.make(FSUtil.resolve("/repo/packages/core"))
const projectDirectory = AbsolutePath.make(FSUtil.resolve("/repo"))
const instructionFile = FSUtil.resolve("/repo/AGENTS.md")
const timestamp = Date.parse("2026-06-03T12:00:00.000Z")
const localDate = (time: number) => new Date(time).toDateString()
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location(
      { directory },
      { projectDirectory, vcs: { type: "git", store: AbsolutePath.make(FSUtil.resolve("/repo/.git")) } },
    ),
  ),
)
const builtInsNode = LayerNode.group([SystemContextBuiltIns.node, SystemContextRegistry.node])
const osName = (platform: string) =>
  platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform
const expectedOS = `  OS: ${osName(process.platform)} (${process.arch})`
const expectedShell = () => {
  const resolved = Shell.preferred()
  return `  Shell: ${Shell.name(resolved)} (${resolved})`
}
const it = testEffect(
  AppNodeBuilder.build(builtInsNode, [
    [Location.node, locationLayer],
    [Global.node, Global.layerWith({ config: "/global" })],
  ]),
)
const instructionFS = Layer.effect(
  FSUtil.Service,
  FSUtil.Service.pipe(
    Effect.map((fs) =>
      FSUtil.Service.of({
        ...fs,
        up: () => Effect.succeed([instructionFile]),
        readFileStringSafe: (path) => Effect.succeed(path === instructionFile ? "Be precise." : undefined),
      }),
    ),
  ),
).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
const itWithInstructions = testEffect(
  AppNodeBuilder.build(builtInsNode, [
    [Location.node, locationLayer],
    [FSUtil.node, instructionFS],
    [Global.node, Global.layerWith({ config: "/global" })],
  ]),
)
const configWithShell = (shell: string) =>
  Config.Service.of({
    entries: () =>
      Effect.succeed([new Config.Document({ type: "document", info: new Config.Info({ shell }) })]),
  })

describe("SystemContextBuiltIns", () => {
  it.effect("loads location-scoped environment and host-local date context", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SystemContextRegistry.Service
      const initialized = yield* SystemContext.initialize(yield* context.load())

      expect(initialized.baseline).toBe(
        [
          "Here is some useful information about the environment you are running in:",
          "<env>",
          `  Working directory: ${directory}`,
          `  Workspace root folder: ${projectDirectory}`,
          "  Is directory a git repo: yes",
          `  Platform: ${process.platform}`,
          expectedOS,
          expectedShell(),
          "</env>",
          "",
          `Today's date: ${localDate(timestamp)}`,
        ].join("\n"),
      )
    }),
  )

  it.effect("reconciles the date without repeating unchanged environment context", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SystemContextRegistry.Service
      const initialized = yield* SystemContext.initialize(yield* context.load())

      yield* TestClock.setTime(timestamp + 24 * 60 * 60 * 1000)
      const refreshed = yield* SystemContext.reconcile(yield* context.load(), initialized.snapshot)

      expect(refreshed).toMatchObject({
        _tag: "Updated",
        text: `Today's date is now: ${localDate(timestamp + 24 * 60 * 60 * 1000)}`,
      })
    }),
  )

  it.effect("does not update again within the same local calendar day", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SystemContextRegistry.Service
      const initialized = yield* SystemContext.initialize(yield* context.load())

      yield* TestClock.setTime(timestamp + 60 * 60 * 1000)
      expect(yield* SystemContext.reconcile(yield* context.load(), initialized.snapshot)).toEqual({ _tag: "Unchanged" })
    }),
  )

  itWithInstructions.effect("composes ambient instructions after built-in context", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SystemContextRegistry.Service

      expect((yield* SystemContext.initialize(yield* context.load())).baseline).toBe(
        [
          "Here is some useful information about the environment you are running in:",
          "<env>",
          `  Working directory: ${directory}`,
          `  Workspace root folder: ${projectDirectory}`,
          "  Is directory a git repo: yes",
          `  Platform: ${process.platform}`,
          expectedOS,
          expectedShell(),
          "</env>",
          "",
          `Today's date: ${localDate(timestamp)}`,
          "",
          `Instructions from: ${instructionFile}\nBe precise.`,
        ].join("\n"),
      )
    }),
  )

  it.effect("uses the configured shell in the env block", () =>
    Effect.gen(function* () {
      const preferred = spyOn(Shell, "preferred").mockReturnValue("/mock/custom-shell")
      try {
        yield* TestClock.setTime(timestamp)
        const baseline = yield* Effect.gen(function* () {
          const context = yield* SystemContextRegistry.Service
          const loaded = yield* context.load()
          return (yield* SystemContext.initialize(loaded)).baseline
        }).pipe(Effect.provideService(Config.Service, configWithShell("configured-shell")))
        expect(preferred).toHaveBeenCalledWith("configured-shell")
        expect(baseline).toContain("  Shell: custom-shell (/mock/custom-shell)")
        expect(baseline).toMatch(/  OS: .+ \(.+\)/)
      } finally {
        preferred.mockRestore()
        Shell.preferred.reset()
        Shell.acceptable.reset()
      }
    }),
  )

  it.effect("labels the OS per platform", () =>
    Effect.gen(function* () {
      const preferred = spyOn(Shell, "preferred").mockReturnValue("/mock/sh")
      const originalPlatform = process.platform
      const cases = [
        ["win32", "Windows"],
        ["darwin", "macOS"],
        ["linux", "Linux"],
      ] as const
      try {
        yield* TestClock.setTime(timestamp)
        for (const [platform, name] of cases) {
          Object.defineProperty(process, "platform", { value: platform })
          const context = yield* SystemContextRegistry.Service
          const baseline = (yield* SystemContext.initialize(yield* context.load())).baseline
          expect(baseline).toContain(`  OS: ${name} (${process.arch})`)
        }
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform })
        preferred.mockRestore()
        Shell.preferred.reset()
        Shell.acceptable.reset()
      }
    }),
  )
})
