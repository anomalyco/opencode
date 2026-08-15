import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"

import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)
const systemHook = "experimental.chat.system.transform"

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const file = path.join(test.directory, "plugin.ts")
    yield* Effect.all(
      [
        Effect.promise(() => Bun.write(file, source)),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
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
  })
}

function withPlugins<A, E, R>(sources: string[], self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const files = sources.map((_, index) => path.join(test.directory, `plugin${index}.ts`))
    yield* Effect.all(
      [
        ...sources.map((source, index) => Effect.promise(() => Bun.write(files[index], source))),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                plugin: files.map((file) => pathToFileURL(file).href),
              },
              null,
              2,
            ),
          ),
        ),
      ],
      { discard: true, concurrency: "unbounded" },
    )
    return yield* self
  })
}

const triggerSystemTransform = Effect.fn("PluginTriggerTest.triggerSystemTransform")(function* () {
  const plugin = yield* Plugin.Service
  const out = { system: [] as string[] }
  yield* plugin.trigger(
    systemHook,
    {
      model: {
        providerID: ProviderV2.ID.anthropic,
        modelID: ModelV2.ID.make("claude-sonnet-4-6"),
      },
    },
    out,
  )
  return out.system
})

describe("plugin.trigger", () => {
  it.instance("runs synchronous hooks without crashing", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["sync"])
      }),
    ),
  )

  it.instance("isolates a throwing accumulating hook from later plugins", () =>
    withPlugins(
      [
        [
          "export default async () => ({",
          '  "chat.params": async () => {',
          '    throw new Error("boom")',
          "  },",
          "})",
          "",
        ].join("\n"),
        [
          "export default async () => ({",
          '  "chat.params": async (_input, output) => {',
          '    output.options.marker = "second"',
          "  },",
          "})",
          "",
        ].join("\n"),
      ],
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const out = {
          temperature: 0,
          topP: 0,
          topK: 0,
          maxOutputTokens: undefined as number | undefined,
          options: {} as Record<string, any>,
        }
        yield* plugin.trigger("chat.params", {}, out)
        expect(out.options.marker).toBe("second")
      }),
    ),
  )

  it.instance("propagates a throwing tool.execute.before hook", () =>
    withPlugins(
      [
        [
          "export default async () => ({",
          '  "tool.execute.before": async () => {',
          '    throw new Error("blocked")',
          "  },",
          "})",
          "",
        ].join("\n"),
      ],
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const exit = yield* plugin
          .trigger("tool.execute.before", { tool: "bash", sessionID: "ses_test", callID: "call_test" }, { args: {} })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    ),
  )

  it.instance("awaits asynchronous hooks", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: async (_input, output) => {`,
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["async"])
      }),
    ),
  )
})
