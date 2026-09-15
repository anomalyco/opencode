import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { provideInstance, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { ProviderAuth } from "@/provider/auth"

import { RuntimeFlags } from "@/effect/runtime-flags"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Config } from "@/config/config"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))

function providerAuthLayer(directory: string, plugins: string[]) {
  return LayerNode.compile(ProviderAuth.node, [
    [
      Config.node,
      TestConfig.layer({
        get: () =>
          Effect.succeed({
            plugin: plugins,
            plugin_origins: plugins.map((plugin) => ({
              spec: plugin,
              source: path.join(directory, "opencode.json"),
              scope: "local" as const,
            })),
          }),
        directories: () => Effect.succeed([directory]),
      }),
    ],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ])
}

describe("plugin.auth-override", () => {
  it.instance(
    "user plugin overrides built-in github-copilot auth",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* FSUtil.Service
        const pluginDir = path.join(tmp.directory, ".opencode", "plugin")

        yield* fs.writeWithDirs(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default {",
            '  id: "demo.custom-copilot-auth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "github-copilot",',
            "      methods: [",
            '        { type: "api", label: "Test Override Auth" },',
            "      ],",
            "      loader: async () => ({ access: 'test-token' }),",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )

        const plain = yield* tmpdirScoped({ git: true })
        const plugin = pathToFileURL(path.join(pluginDir, "custom-copilot-auth.ts")).href
        const methods = yield* ProviderAuth.use
          .methods()
          .pipe(Effect.provide(providerAuthLayer(tmp.directory, [plugin])))
        const plainMethods = yield* ProviderAuth.use
          .methods()
          .pipe(Effect.provide(providerAuthLayer(plain, [])), provideInstance(plain))

        const copilot = methods[ProviderV2.ID.make("github-copilot")]
        expect(copilot).toBeDefined()
        expect(copilot.length).toBe(1)
        expect(copilot[0].label).toBe("Test Override Auth")
        expect(plainMethods[ProviderV2.ID.make("github-copilot")][0].label).not.toBe("Test Override Auth")
      }),
    { git: true },
    30000,
  )
})

const file = path.join(import.meta.dir, "../../src/plugin/index.ts")

describe("plugin.config-hook-error-isolation", () => {
  test("config hooks are individually error-isolated in the layer factory", async () => {
    const src = await Bun.file(file).text()

    // Each hook's config call is wrapped in Effect.tryPromise with error logging + Effect.ignore
    expect(src).toContain("plugin config hook failed")

    const pattern =
      /for\s*\(const hook of hooks\)\s*\{[\s\S]*?Effect\.tryPromise[\s\S]*?\.config\?\.\([\s\S]*?plugin config hook failed[\s\S]*?Effect\.ignore/
    expect(pattern.test(src)).toBe(true)
  })
})

describe("plugin.auth-sync-return", () => {
  it.instance(
    "handles a plugin auth method whose authorize returns synchronously",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* FSUtil.Service
        const pluginDir = path.join(tmp.directory, ".opencode", "plugin")

        yield* fs.writeWithDirs(
          path.join(pluginDir, "sync-auth.ts"),
          [
            "export default {",
            '  id: "demo.sync-auth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "custom-provider",',
            "      methods: [",
            "        { type: 'oauth', label: 'Sync Auth', authorize() {",
            "          return { url: 'https://example.com/auth', method: 'poll' }",
            "        } },",
            "      ],",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )

        const plugin = pathToFileURL(path.join(pluginDir, "sync-auth.ts")).href
        const methods = yield* ProviderAuth.use
          .methods()
          .pipe(Effect.provide(providerAuthLayer(tmp.directory, [plugin])))

        const custom = methods[ProviderV2.ID.make("custom-provider")]
        expect(custom).toBeDefined()
        expect(custom.length).toBe(1)

        const result = yield* ProviderAuth.use.authorize({
          providerID: ProviderV2.ID.make("custom-provider"),
          method: 0,
        }).pipe(Effect.provide(providerAuthLayer(tmp.directory, [plugin])))

        expect(result.url).toBe("https://example.com/auth")
        expect(result.method).toBe("poll")
      }),
    { git: true },
    30000,
  )

  it.instance(
    "surfaces authorize failure as a catchable error, not a defect",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* FSUtil.Service
        const pluginDir = path.join(tmp.directory, ".opencode", "plugin")

        yield* fs.writeWithDirs(
          path.join(pluginDir, "failing-auth.ts"),
          [
            "export default {",
            '  id: "demo.failing-auth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "failing-provider",',
            "      methods: [",
            "        { type: 'oauth', label: 'Failing Auth', authorize() {",
            "          throw new Error('authorize exploded')",
            "        } },",
            "      ],",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )

        const plugin = pathToFileURL(path.join(pluginDir, "failing-auth.ts")).href
        const layer = providerAuthLayer(tmp.directory, [plugin])

        const result = yield* ProviderAuth.use.authorize({
          providerID: ProviderV2.ID.make("failing-provider"),
          method: 0,
        }).pipe(
          Effect.provide(layer),
          Effect.map((v) => ({ _tag: "Right" as const, value: v })),
          Effect.catchCause((cause) => Effect.succeed({ _tag: "Left" as const, error: String(cause) })),
        )

        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.error).toContain("authorize exploded")
        }
      }),
    { git: true },
    30000,
  )
})
