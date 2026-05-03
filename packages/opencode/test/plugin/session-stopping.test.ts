import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import { pathToFileURL } from "url"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const it = testEffect(Layer.mergeAll(Plugin.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterAll(() => {
  if (disableDefault === undefined) {
    delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
    return
  }
  process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = disableDefault
})

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "plugin.ts")
      yield* Effect.all(
        [
          Effect.promise(() => Bun.write(file, source)),
          Effect.promise(() =>
            Bun.write(
              path.join(dir, "opencode.json"),
              JSON.stringify(
                {
                  $schema: "https://opencode.ai/config.json",
                  plugin: [pathToFileURL(file).href],
                },
                null,
                2,
              ),
            ),
          ),
        ],
        { discard: true, concurrency: 2 },
      )
      return yield* self
    }),
  )
}

const triggerStopping = Effect.fn("SessionStoppingTest.triggerStopping")(function* () {
  const plugin = yield* Plugin.Service
  return yield* plugin.trigger(
    "session.stopping",
    { sessionID: "test-session" },
    { stop: true, message: undefined as string | undefined },
  )
})

describe("session.stopping hook", () => {
  it.live("allows plugins to prevent stop and inject a message", () =>
    withProject(
      [
        "export default async () => ({",
        '  "session.stopping": (_input, output) => {',
        "    output.stop = false",
        '    output.message = "workflow gate"',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const out = yield* triggerStopping()
        expect(out.stop).toBe(false)
        expect(out.message).toBe("workflow gate")
      }),
    ),
  )

  it.live("keeps stop true when no plugin handles it", () =>
    withProject(
      ["export default async () => ({})", ""].join("\n"),
      Effect.gen(function* () {
        const out = yield* triggerStopping()
        expect(out.stop).toBe(true)
        expect(out.message).toBeUndefined()
      }),
    ),
  )
})
