import { describe, expect } from "bun:test"
import { generateText } from "ai"
import path from "path"
import { pathToFileURL } from "url"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect } from "effect"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Provider } from "@/provider/provider"
import { TestConfig } from "../fixture/config"
import { provideInstance, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Contract tests for plugin-host runtime behavior listed in anomalyco/opencode#51614.
// Every case loads a real fixture plugin (file:// spec) through the real host layers.

const PROVIDER_ID = "contract-probe"
const MODEL_ID = "contract-model"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))

function probeProvider(api: string): NonNullable<ConfigV1.Info["provider"]> {
  return {
    [PROVIDER_ID]: {
      name: "Contract Probe",
      npm: "@ai-sdk/openai-compatible",
      api,
      options: { apiKey: "probe-key" },
      models: {
        [MODEL_ID]: {
          name: "Contract Model",
          tool_call: true,
          limit: { context: 128000, output: 4096 },
        },
      },
    },
  }
}

function hostLayer(input: {
  directory: string
  plugins: string[]
  provider?: NonNullable<ConfigV1.Info["provider"]>
  nodes?: Parameters<typeof LayerNode.group>[0]
}) {
  return LayerNode.compile(
    LayerNode.group(input.nodes ?? [Provider.node, Auth.node]),
    [
      [
        Config.node,
        TestConfig.layer({
          get: () =>
            Effect.succeed({
              plugin: input.plugins,
              plugin_origins: input.plugins.map((plugin) => ({
                spec: plugin,
                source: path.join(input.directory, "opencode.json"),
                scope: "local" as const,
              })),
              provider: input.provider,
            }),
          directories: () => Effect.succeed([input.directory]),
        }),
      ],
      [RuntimeFlags.node, RuntimeFlags.layer()],
    ],
  )
}

function writePlugin(fs: FSUtil.Interface, directory: string, name: string, source: string) {
  return Effect.gen(function* () {
    const file = path.join(directory, ".opencode", "plugin", name)
    yield* fs.writeWithDirs(file, source)
    return pathToFileURL(file).href
  })
}

// Loader plugin: records every loader invocation into a marker file next to the plugin
// (plugin code runs in-process, but the marker keeps the observation cross-boundary).
function loaderPluginSource(marker: string) {
  return [
    "let invocations = 0",
    "export default {",
    '  id: "contract.auth-loader",',
    "  server: async () => {",
    `    await Bun.write(${JSON.stringify(marker + ".loaded")}, "1")`,
    "    return {",
    "      auth: {",
    `        provider: ${JSON.stringify(PROVIDER_ID)},`,
    '        methods: [{ type: "api", label: "Contract Probe" }],',
    "        loader: async () => {",
    "          invocations += 1",
    `          await Bun.write(${JSON.stringify(marker)}, String(invocations))`,
    "          return { someOption: 1 }",
    "        },",
    "      },",
    "    }",
    "  },",
    "}",
    "",
  ].join("\n")
}

// Fetch plugin: returns a custom fetch from the loader that marks every outgoing request.
function fetchPluginSource() {
  return [
    "export default {",
    '  id: "contract.custom-fetch",',
    "  server: async () => ({",
    "    auth: {",
    `      provider: ${JSON.stringify(PROVIDER_ID)},`,
    '      methods: [{ type: "api", label: "Contract Probe" }],',
    "      loader: async () => ({",
    "        fetch: async (input, init) => {",
    '          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))',
    '          headers.set("x-contract-probe", "1")',
    "          return fetch(input, { ...init, headers })",
    "        },",
    "      }),",
    "    },",
    "  }),",
    "}",
    "",
  ].join("\n")
}

describe("plugin auth host contract", () => {
  it.instance(
    "auth.loader runs only when the auth store has an entry for its provider",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* FSUtil.Service

        // Case A: no stored credential for the provider -> loader must not run.
        const plain = yield* tmpdirScoped({ git: true })
        const plainMarker = path.join(plain, "loader-marker.txt")
        const plainPlugin = yield* writePlugin(fs, plain, "auth-loader.ts", loaderPluginSource(plainMarker))

        const withoutAuth = yield* Effect.gen(function* () {
          const auth = yield* Auth.Service
          yield* auth.remove(PROVIDER_ID)
          return yield* Provider.use.list()
        }).pipe(
          Effect.provide(hostLayer({ directory: plain, plugins: [plainPlugin], provider: probeProvider("http://127.0.0.1:9/v1") })),
          provideInstance(plain),
        )

        // The plugin loaded (server hook ran) but its loader stayed untouched.
        expect(yield* fs.existsSafe(plainMarker + ".loaded")).toBe(true)
        expect(yield* fs.existsSafe(plainMarker)).toBe(false)
        expect(withoutAuth[ProviderV2.ID.make(PROVIDER_ID)]).toBeDefined()
        expect(withoutAuth[ProviderV2.ID.make(PROVIDER_ID)].options.someOption).toBeUndefined()

        // Case B: stored credential present -> loader runs once and its options are merged.
        const marker = path.join(tmp.directory, "loader-marker.txt")
        const plugin = yield* writePlugin(fs, tmp.directory, "auth-loader.ts", loaderPluginSource(marker))

        const withAuth = yield* Effect.gen(function* () {
          const auth = yield* Auth.Service
          yield* auth.set(PROVIDER_ID, { type: "api", key: "stored-key" })
          const providers = yield* Provider.use.list()
          yield* auth.remove(PROVIDER_ID)
          return providers
        }).pipe(
          Effect.provide(
            hostLayer({ directory: tmp.directory, plugins: [plugin], provider: probeProvider("http://127.0.0.1:9/v1") }),
          ),
        )

        expect(yield* fs.readFileStringSafe(marker)).toBe("1")
        expect(withAuth[ProviderV2.ID.make(PROVIDER_ID)].options.someOption).toBe(1)
      }),
    { git: true },
    30000,
  )

  it.instance(
    "custom fetch returned by the loader reaches the real provider request",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* FSUtil.Service
        const seen: Array<Record<string, string>> = []

        const server = Bun.serve({
          port: 0,
          fetch(request) {
            seen.push(Object.fromEntries(request.headers))
            return Response.json({
              id: "chatcmpl-contract",
              object: "chat.completion",
              created: 1,
              model: MODEL_ID,
              choices: [{ index: 0, message: { role: "assistant", content: "probe-ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            })
          },
        })

        try {
          const plugin = yield* writePlugin(fs, tmp.directory, "custom-fetch.ts", fetchPluginSource())
          const baseURL = `http://127.0.0.1:${server.port}/v1`

          const result = yield* Effect.gen(function* () {
            const auth = yield* Auth.Service
            yield* auth.set(PROVIDER_ID, { type: "api", key: "stored-key" })
            const model = yield* Provider.use.getModel(ProviderV2.ID.make(PROVIDER_ID), ModelV2.ID.make(MODEL_ID))
            const language = yield* Provider.use.getLanguage(model)
            yield* auth.remove(PROVIDER_ID)
            return yield* Effect.promise(() => generateText({ model: language, prompt: "probe", maxRetries: 0 }))
          }).pipe(Effect.provide(hostLayer({ directory: tmp.directory, plugins: [plugin], provider: probeProvider(baseURL) })))

          expect(result.text).toBe("probe-ok")
          expect(seen.length).toBe(1)
          expect(seen[0]["x-contract-probe"]).toBe("1")
        } finally {
          server.stop(true)
        }
      }),
    { git: true },
    30000,
  )

  it.instance(
    "client.auth.set from a plugin writes through the runtime client after plugins load",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* FSUtil.Service

        const plugin = yield* writePlugin(
          fs,
          tmp.directory,
          "client-auth-set.ts",
          [
            "export default {",
            '  id: "contract.client-auth-set",',
            "  server: async (input) => {",
            "    await input.client.auth.set({",
            `      path: { id: ${JSON.stringify(PROVIDER_ID)} },`,
            '      body: { type: "api", key: "plugin-written-key" },',
            "    })",
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        // The plugin's client targets the in-process server app (no listener is started in
        // tests, so PluginInput.client falls back to Server.Default().app.fetch). The write
        // therefore exercises the real PUT /auth/:providerID route and the shared auth store.
        const entry = yield* Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          yield* plugin.list()
          const auth = yield* Auth.Service
          const stored = yield* auth.get(PROVIDER_ID)
          yield* auth.remove(PROVIDER_ID)
          return stored
        }).pipe(
          Effect.provide(hostLayer({ directory: tmp.directory, plugins: [plugin], nodes: [Plugin.node, Auth.node] })),
          provideInstance(tmp.directory),
        )

        expect(entry).toBeDefined()
        expect(entry?.type).toBe("api")
        if (entry?.type === "api") expect(entry.key).toBe("plugin-written-key")
      }),
    { git: true },
    30000,
  )
})