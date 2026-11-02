import { describe, expect } from "bun:test"
import os from "os"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/core/schema"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { Sandbox } from "@opencode/core/sandbox"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const directory = AbsolutePath.make(FSUtil.resolve("/repo/packages/core"))
const projectDirectory = AbsolutePath.make(FSUtil.resolve("/repo"))
const timestamp = Date.parse("2026-06-03T12:00:00.000Z")
const temporary = os.tmpdir()
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
const it = testEffect(
  AppNodeBuilder.build(InstructionBuiltIns.node, [
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: temporary, tmp: temporary })),
  ]),
)

describe("InstructionBuiltIns", () => {
  it.effect("loads location-scoped environment and host-local date instructions", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load())

      expect(initialized.text).toBe(
        [
          `Today's date: ${localDate(timestamp)}`,
          "",
          "Here is some useful information about the environment you are running in:",
          "<env>",
          `  Working directory: ${directory}`,
          `  Workspace root folder: ${projectDirectory}`,
          "  Is directory a git repo: yes",
          `  Platform: ${process.platform}`,
          `  Prefer ${temporary} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
          "</env>",
        ].join("\n"),
      )
    }),
  )

  it.effect("updates temporary directory instructions as sandbox settings and scratch change", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const original = yield* readInitial(yield* context.load())
      const scratch = FSUtil.resolve("/sandbox/first")
      const restartedScratch = FSUtil.resolve("/sandbox/second")
      const sandboxLayer = (directory: string) =>
        AppNodeBuilder.build(InstructionBuiltIns.node, [
          Location.node.replace(locationLayer),
          Global.node.replace(Global.layerWith({ config: temporary, tmp: temporary })),
          Sandbox.node.replace(
            Layer.mock(Sandbox.Service, {
              enabled: true,
              scratch: directory,
              approval: "on-request",
              fullDiskRead: false,
              status: () => Effect.succeed({ active: true, reads: "restricted", escalation: "on-request", writableRoots: [], readableRoots: [] }),
            }),
          ),
        ])
      const update = (directory: string, previous: typeof original) =>
        Effect.gen(function* () {
          const builtins = yield* InstructionBuiltIns.Service
          return yield* readUpdate(yield* builtins.load(), previous)
        }).pipe(Effect.provide(Layer.fresh(sandboxLayer(directory))))

      const sandboxed = yield* update(scratch, original)
      expect(sandboxed.text).toContain(`Prefer ${scratch} for temporary files`)
      expect(sandboxed.text).not.toContain(`Prefer ${temporary} over`)
      const restarted = yield* update(restartedScratch, sandboxed)
      expect(restarted.text).toContain(`Prefer ${restartedScratch} for temporary files`)
      expect(restarted.text).not.toContain(`Prefer ${scratch} for temporary files`)
      const unsandboxed = yield* readUpdate(yield* context.load(), restarted)
      expect(unsandboxed.text).toContain(`Prefer ${temporary} over`)
      expect(unsandboxed.text).not.toContain(restartedScratch)
      expect((yield* readUpdate(yield* context.load(), unsandboxed)).changed).toBe(false)
    }),
  )

  it.effect("updates the date without repeating unchanged environment instructions", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load())

      yield* TestClock.setTime(timestamp + 24 * 60 * 60 * 1000)
      const refreshed = yield* readUpdate(yield* context.load(), initialized)

      expect(refreshed.text).toBe(`Today's date is now: ${localDate(timestamp + 24 * 60 * 60 * 1000)}`)
    }),
  )

  it.effect("does not update again within the same local calendar day", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load())

      yield* TestClock.setTime(timestamp + 60 * 60 * 1000)
      expect((yield* readUpdate(yield* context.load(), initialized)).changed).toBe(false)
    }),
  )
})
