import { afterAll, afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import { pathToFileURL } from "url"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const { Instance } = await import("../../src/project/instance")
const it = testEffect(Layer.mergeAll(Plugin.defaultLayer, CrossSpawnSpawner.defaultLayer))

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

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "plugin.ts")
      yield* Effect.promise(() => Bun.write(file, source))
      yield* Effect.promise(() =>
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
      )
      return yield* self
    }),
  )
}

const trigger = Effect.fn("PluginTriggerTest.trigger")(function* () {
  const plugin = yield* Plugin.Service
  const out = { system: [] as string[] }
  yield* plugin.trigger(
    "experimental.chat.system.transform",
    {
      model: {
        providerID: ProviderID.make("anthropic"),
        modelID: ModelID.make("claude-sonnet-4-6"),
      },
    },
    out,
  )
  return out
})

describe("plugin.trigger", () => {
  it.live("runs synchronous hooks without crashing", () =>
    withProject(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": (_input, output) => {',
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect((yield* trigger()).system).toEqual(["sync"])
      }),
    ),
  )

  it.live("awaits asynchronous hooks", () =>
    withProject(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": async (_input, output) => {',
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect((yield* trigger()).system).toEqual(["async"])
      }),
    ),
  )
})
