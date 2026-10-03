import { describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import { Account } from "../../src/account/account"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { NpmTest } from "../fake/npm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

describe("plugin.auth", () => {
  it.instance("reads and compare-and-sets stored credentials without an HTTP auth read", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "auth-slot-plugin.ts")
      yield* Effect.promise(() =>
        Bun.write(
          file,
          `export default async (input) => ({
            "experimental.chat.system.transform": async (_request, output) => {
              const before = await input.auth.get("slot-provider")
              const first = await input.auth.compareAndSet("slot-provider", undefined, { type: "api", key: "first" })
              const second = await input.auth.compareAndSet("slot-provider", undefined, { type: "api", key: "second" })
              output.system.push(JSON.stringify({ before, first, second, after: await input.auth.get("slot-provider"), httpRead: typeof input.client.auth.get }))
            },
          })`,
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(path.join(test.directory, "opencode.json"), JSON.stringify({ plugin: [pathToFileURL(file).href] })),
      )
      const plugin = yield* Plugin.Service
      const output = { system: [] as string[] }
      yield* plugin.trigger(
        "experimental.chat.system.transform",
        { model: { providerID: ProviderV2.ID.anthropic, modelID: ModelV2.ID.make("claude-sonnet-4-6") } },
        output,
      )
      expect(JSON.parse(output.system[0]!)).toEqual({
        first: { written: true, current: { type: "api", key: "first" } },
        second: { written: false, current: { type: "api", key: "first" } },
        after: { type: "api", key: "first" },
        httpRead: "undefined",
      })
    }),
  )
})
