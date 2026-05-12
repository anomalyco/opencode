import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { provideInstance, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { ProviderAuth } from "@/provider/auth"
import { ProviderID } from "../../src/provider/schema"
import { Plugin } from "@/plugin"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, AppFileSystem.defaultLayer))

function layer(directory: string, plugins: string[]) {
  return ProviderAuth.layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(
      Plugin.layer.pipe(
        Layer.provide(Bus.layer),
        Layer.provide(
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
        ),
      ),
    ),
  )
}

describe("plugin.auth-override", () => {
  it.instance(
    "user plugin overrides built-in github-copilot auth",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* AppFileSystem.Service
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
        const methods = yield* ProviderAuth.Service.use((svc) => svc.methods()).pipe(
          Effect.provide(layer(tmp.directory, [plugin])),
        )
        const plainMethods = yield* ProviderAuth.Service.use((svc) => svc.methods()).pipe(
          Effect.provide(layer(plain, [])),
          provideInstance(plain),
        )

        const copilot = methods[ProviderID.make("github-copilot")]
        expect(copilot).toBeDefined()
        expect(copilot.length).toBe(1)
        expect(copilot[0].label).toBe("Test Override Auth")
        expect(plainMethods[ProviderID.make("github-copilot")][0].label).not.toBe("Test Override Auth")
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
