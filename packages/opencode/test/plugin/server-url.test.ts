import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
import { Server } from "../../src/server/server"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { Npm } from "@opencode-ai/core/npm"
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

// The plugin reports what it was given through a system transform, so the test reads the
// real PluginInput without reaching into globals.
const source = [
  "export default async (input) => ({",
  '  "experimental.chat.system.transform": async (_input, output) => {',
  "    const project = await input.client.project.current()",
  '    output.system.push(String(input.serverUrl), project.data?.worktree === input.worktree ? "client ok" : "client failed")',
  "  },",
  "})",
  "",
].join("\n")

const report = Effect.fn("PluginServerUrlTest.report")(function* () {
  const test = yield* TestInstance
  const file = path.join(test.directory, "plugin.ts")
  yield* Effect.promise(() =>
    Promise.all([
      Bun.write(file, source),
      Bun.write(
        path.join(test.directory, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [pathToFileURL(file).href] }),
      ),
    ]),
  )
  const plugin = yield* Plugin.Service
  const out = { system: [] as string[] }
  yield* plugin.trigger(
    "experimental.chat.system.transform",
    { model: { providerID: ProviderV2.ID.anthropic, modelID: ModelV2.ID.make("claude-sonnet-4-6") } },
    out,
  )
  return out.system
})

describe("plugin input serverUrl", () => {
  it.instance(
    "is undefined without an HTTP listener and the client stays in-process",
    () =>
      Effect.gen(function* () {
        expect(Server.url).toBeUndefined()
        expect(yield* report()).toEqual(["undefined", "client ok"])
      }),
    30_000,
  )

  it.instance(
    "is the listener URL when one is running",
    () =>
      Effect.gen(function* () {
        const listener = yield* Effect.acquireRelease(
          Effect.promise(() => Server.listen({ hostname: "127.0.0.1", port: 0 })),
          (listener) => Effect.promise(() => listener.stop(true)),
        )
        expect(yield* report()).toEqual([listener.url.toString(), "client ok"])
      }),
    30_000,
  )
})
