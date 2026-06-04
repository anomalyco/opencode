import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionSystemContext } from "@opencode-ai/core/session-system-context"
import { SystemContext } from "@opencode-ai/core/system-context"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const directory = AbsolutePath.make("/repo/packages/core")
const projectDirectory = AbsolutePath.make("/repo")
const timestamp = Date.parse("2026-06-03T12:00:00.000Z")
const localDate = (time: number) => new Date(time).toDateString()
const it = testEffect(
  SessionSystemContext.locationLayer.pipe(
    Layer.provide(
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location({ directory }, { projectDirectory, vcs: { type: "git", store: AbsolutePath.make("/repo/.git") } }),
        ),
      ),
    ),
  ),
)

describe("SessionSystemContext", () => {
  it.effect("loads location-scoped environment and host-local date context", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SessionSystemContext.Service
      const initialized = SystemContext.initialize(yield* context.load())

      expect(initialized.baseline).toEqual([
        {
          key: SystemContext.Key.make("core/environment"),
          text: [
            "Here is some useful information about the environment you are running in:",
            "<env>",
            `  Working directory: ${directory}`,
            `  Workspace root folder: ${projectDirectory}`,
            "  Is directory a git repo: yes",
            `  Platform: ${process.platform}`,
            "</env>",
          ].join("\n"),
        },
        { key: SystemContext.Key.make("core/date"), text: `Today's date: ${localDate(timestamp)}` },
      ])
    }),
  )

  it.effect("refreshes the date without repeating unchanged environment context", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* SessionSystemContext.Service
      const initialized = SystemContext.initialize(yield* context.load())

      yield* TestClock.setTime(timestamp + 24 * 60 * 60 * 1000)
      const refreshed = SystemContext.refresh(yield* context.load(), initialized.checkpoint)

      expect(refreshed.changes).toEqual([
        {
          key: SystemContext.Key.make("core/date"),
          text: `Today's date is now: ${localDate(timestamp + 24 * 60 * 60 * 1000)}`,
        },
      ])
    }),
  )
})
