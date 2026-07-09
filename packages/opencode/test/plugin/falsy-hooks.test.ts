import { describe, expect } from "bun:test"
import { Effect } from "effect"
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

const listHooks = Effect.gen(function* () {
  const plugin = yield* Plugin.Service
  yield* plugin.init()
  return yield* plugin.list()
})

// A falsy entry in the hooks array breaks every consumer that dereferences
// hook properties directly — most visibly the Provider state build
// (hook.provider), which turns into a 500 from /config/providers and makes
// the whole instance unusable. These tests pin down that plugin loading
// never lets a falsy hook through.
describe("plugin falsy hook returns", () => {
  it.instance("legacy module: stray helper export resolving undefined is skipped, real plugin loads", () =>
    withProject(
      [
        "// legacy shape: every function export is loaded as a plugin, so the",
        "// helper below is called with (input, options) and returns undefined.",
        "export function helper() {}",
        "export const realPlugin = async () => ({",
        "  async config(_cfg) {},",
        "})",
        "export default realPlugin",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const hooks = yield* listHooks
        expect(hooks.every(Boolean)).toBe(true)
        // the real plugin's hooks made it in; only the helper was dropped
        expect(hooks.some((hook) => typeof hook.config === "function")).toBe(true)
      }),
    ),
  )

  it.instance("v1 module: server() resolving undefined is skipped", () =>
    withProject(
      ["export default {", '  id: "demo.falsy-hooks",', "  server: async () => undefined,", "}", ""].join("\n"),
      Effect.gen(function* () {
        const hooks = yield* listHooks
        expect(hooks.every(Boolean)).toBe(true)
      }),
    ),
  )
})
