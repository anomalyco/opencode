import { describe, expect } from "bun:test"
import os from "os"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Config } from "@opencode-ai/core/config"
import { Document, Info } from "@opencode-ai/schema/config"
import { InstructionBuiltIns } from "@opencode-ai/core/instructions/builtins"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const directory = AbsolutePath.make(FSUtil.resolve("/repo/packages/core"))
const projectDirectory = AbsolutePath.make(FSUtil.resolve("/repo"))
const timestamp = Date.parse("2026-06-03T12:00:00.000Z")
const sessionID = SessionSchema.ID.make("ses_builtin_test")
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
const osName = (platform: string) =>
  platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform
const expectedOS = `  OS: ${osName(process.platform)} (${process.arch})`
const baseLayer = (entries: Parameters<typeof Config.testLayer>[0] = []) =>
  AppNodeBuilder.build(InstructionBuiltIns.node, [
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: temporary, tmp: temporary })),
    Config.node.replace(Config.testLayer(entries)),
  ])
const it = testEffect(baseLayer())

describe("InstructionBuiltIns", () => {
  it.effect("loads location-scoped environment and host-local date instructions", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load(sessionID))

      expect(initialized.text).toContain(
        [
          "Here is some useful information about the environment you are running in:",
          "<env>",
          `  Current conversation session ID: ${sessionID}`,
          `  Working directory: ${directory}`,
          `  Workspace root folder: ${projectDirectory}`,
          "  Is directory a git repo: yes",
          `  Platform: ${process.platform}`,
          expectedOS,
        ].join("\n"),
      )
      expect(initialized.text).toMatch(/  Shell: .+ \(.+\)/)
      expect(initialized.text).toContain(
        [
          `  Prefer ${temporary} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
          "</env>",
          "",
          `Today's date: ${localDate(timestamp)}`,
        ].join("\n"),
      )
    }),
  )

  it.effect("updates the date without repeating unchanged environment instructions", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load(sessionID))

      yield* TestClock.setTime(timestamp + 24 * 60 * 60 * 1000)
      const refreshed = yield* readUpdate(yield* context.load(sessionID), initialized)

      expect(refreshed.text).toBe(`Today's date is now: ${localDate(timestamp + 24 * 60 * 60 * 1000)}`)
    }),
  )

  it.effect("does not update again within the same local calendar day", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load(sessionID))

      yield* TestClock.setTime(timestamp + 60 * 60 * 1000)
      expect((yield* readUpdate(yield* context.load(sessionID), initialized)).changed).toBe(false)
    }),
  )
})

describe("InstructionBuiltIns custom instructions", () => {
  const customIt = (entries: Parameters<typeof Config.testLayer>[0]) => testEffect(baseLayer(entries))

  customIt([
    new Document({ type: "document", info: new Info({ customInstructions: "global rules" }) }),
    new Document({ type: "document", info: new Info({ customInstructions: "project rules" }) }),
  ]).effect("merges custom instructions from global-first entries", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load(sessionID))
      expect(initialized.text).toContain("<custom_instructions>\nglobal rules\n\nproject rules\n</custom_instructions>")
    }),
  )

  customIt([
    new Document({ type: "document", info: new Info({ customInstructions: "  custom rules  " }) }),
  ]).effect("trims surrounding whitespace", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load(sessionID))
      expect(initialized.text).toContain("<custom_instructions>\ncustom rules\n</custom_instructions>")
    }),
  )

  customIt([
    new Document({ type: "document", info: new Info({ customInstructions: "   " }) }),
  ]).effect("omits the custom block when custom instructions are blank", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load(sessionID))
      expect(initialized.text).not.toContain("<custom_instructions>")
    }),
  )

  customIt([]).effect("omits the custom block when no custom instructions are configured", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load(sessionID))
      expect(initialized.text).not.toContain("<custom_instructions>")
    }),
  )
})
