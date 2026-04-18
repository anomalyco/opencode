import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const { Instance } = await import("../../src/project/instance")
const { Bus } = await import("../../src/bus")
const { SessionStatus } = await import("../../src/session/status")
const { SessionID } = await import("../../src/session/schema")

afterEach(async () => {
  await Instance.disposeAll()
})

afterAll(() => {
  if (disableDefault === undefined) {
    delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
    return
  }
  process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = disableDefault
})

describe("plugin.waitForPendingEvents - regression test", () => {
  test("does not exit before async event handlers complete", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const completionFile = path.join(dir, "completion.txt")
        const file = path.join(dir, "plugin.ts")

        await Bun.write(
          file,
          [
            `const completionFile = ${JSON.stringify(completionFile)}`,
            "export default async () => ({",
            "  event: async ({ event }) => {",
            "    if (event.type === 'session.idle') {",
            "      // Simulate a slow plugin operation",
            "      await Bun.sleep(200)",
            "      await Bun.write(completionFile, 'completed')",
            "    }",
            "  },",
            "})",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify(
            {
              $schema: "https://opencode.ai/config.json",
              plugin: [pathToFileURL(file).href],
            },
            null,
            2,
          ),
        )

        return completionFile
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const bus = yield* Bus.Service

          // Initialize plugin
          yield* plugin.init()

          // Give plugin time to set up event subscriptions
          yield* Effect.sleep("50 millis")

          // Publish session.idle event
          yield* bus.publish(SessionStatus.Event.Idle, {
            sessionID: SessionID.make("test-session"),
          })

          // Wait for pending events (this is the functionality we're testing)
          yield* plugin.waitForPendingEvents(1000)

          // Check if the plugin completed
          const fileExists = yield* Effect.tryPromise({
            try: () => Bun.file(tmp.extra).exists(),
            catch: () => false,
          })

          // The completion file should exist if waitForPendingEvents worked
          expect(fileExists).toBe(true)

          if (fileExists) {
            const content = yield* Effect.promise(() => Bun.file(tmp.extra).text())
            expect(content).toBe("completed")
          }
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.provide(Bus.layer), Effect.runPromise),
    })
  })

  test("respects timeout and doesn't wait forever", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")

        await Bun.write(
          file,
          [
            "export default async () => ({",
            "  event: async ({ event }) => {",
            "    if (event.type === 'session.idle') {",
            "      // This should timeout",
            "      await Bun.sleep(500)",
            "    }",
            "  },",
            "})",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify(
            {
              $schema: "https://opencode.ai/config.json",
              plugin: [pathToFileURL(file).href],
            },
            null,
            2,
          ),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const bus = yield* Bus.Service

          yield* plugin.init()

          // Give plugin time to set up event subscriptions
          yield* Effect.sleep("50 millis")

          yield* bus.publish(SessionStatus.Event.Idle, {
            sessionID: SessionID.make("test-session"),
          })

          const start = Date.now()
          // Use a short timeout (100ms) - plugin sleeps for 500ms
          yield* plugin.waitForPendingEvents(100)
          const elapsed = Date.now() - start

          // Should timeout around 100ms, not wait for the full 500ms
          // Allow 150ms margin for timing variance
          expect(elapsed).toBeGreaterThan(50)
          expect(elapsed).toBeLessThan(250)
        }).pipe(Effect.provide(Plugin.defaultLayer), Effect.provide(Bus.layer), Effect.runPromise),
    })
  })
})
