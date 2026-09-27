import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Effect } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { generateText } from "ai"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Config } from "@/config/config"
import { Env } from "@/env"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Plugin } from "@/plugin/index"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Provider.node,
      FSUtil.node,
      Env.node,
      Config.node,
      Auth.node,
      Plugin.node,
      ModelsDev.node,
      RuntimeFlags.node,
      CrossSpawnSpawner.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })]],
  ),
)

const providerID = ProviderV2.ID.make("plugin-contract")
const modelID = ModelV2.ID.make("contract-model")
const fixture = pathToFileURL(path.join(import.meta.dir, "fixture", "contract.ts")).href

function server() {
  const headers: string[] = []
  const instance = Bun.serve({
    port: 0,
    fetch(request) {
      headers.push(request.headers.get("x-plugin-contract") ?? "")
      return Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: "contract-model",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    },
  })
  return { instance, headers }
}

function configure(directory: string, baseURL: string, inputPath: string, writeAuth = false) {
  return Bun.write(
    path.join(directory, "opencode.json"),
    JSON.stringify(
      {
        plugin: [[fixture, { inputPath, writeAuth }]],
        provider: {
          "plugin-contract": {
            name: "Plugin contract",
            npm: "@ai-sdk/openai-compatible",
            env: [],
            models: { "contract-model": { name: "Contract model", limit: { context: 1000, output: 100 } } },
            options: { apiKey: "test", baseURL },
          },
        },
      },
      null,
      2,
    ),
  )
}

describe("plugin provider auth host contract", () => {
  it.instance("does not run auth.loader without stored provider auth", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const auth = yield* Auth.Service
      const api = server()
      yield* Effect.addFinalizer(() => Effect.sync(() => api.instance.stop(true)))
      const inputPath = path.join(test.directory, "plugin-input.json")
      yield* Effect.promise(() => configure(test.directory, api.instance.url.toString(), inputPath))
      yield* auth.remove(providerID)

      const providers = yield* Provider.use.list()
      expect(providers[providerID]).toBeDefined()
      expect(yield* Effect.promise(() => Bun.file(inputPath).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(inputPath + ".loader").exists())).toBe(false)
    }),
  )

  it.instance("runs auth.loader with stored auth and applies its fetch to a real provider request", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const auth = yield* Auth.Service
      const api = server()
      yield* Effect.addFinalizer(() => Effect.sync(() => api.instance.stop(true)))
      const inputPath = path.join(test.directory, "plugin-input.json")
      yield* Effect.promise(() => configure(test.directory, api.instance.url.toString(), inputPath))
      yield* auth.set(providerID, { type: "api", key: "contract-key" })
      yield* Effect.addFinalizer(() => auth.remove(providerID).pipe(Effect.ignore))
      const providers = yield* Provider.use.list()
      expect(yield* Effect.promise(() => Bun.file(inputPath + ".loader").text())).toBe("called")
      const model = yield* Provider.use.getModel(providerID, modelID)
      const language = yield* Provider.use.getLanguage(model)
      const result = yield* Effect.promise(() => generateText({ model: language, prompt: "contract" }))

      expect(result.text).toBe("ok")
      expect(api.headers).toEqual(["loaded"])
      expect(providers[providerID]).toBeDefined()
    }),
  )

  it.instance("writes auth through the runtime client HTTP API", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const auth = yield* Auth.Service
      const api = server()
      yield* Effect.addFinalizer(() => Effect.sync(() => api.instance.stop(true)))
      const inputPath = path.join(test.directory, "plugin-input.json")
      yield* Effect.promise(() => configure(test.directory, api.instance.url.toString(), inputPath, true))
      yield* auth.remove("plugin-contract-write")
      yield* Effect.addFinalizer(() => auth.remove("plugin-contract-write").pipe(Effect.ignore))

      yield* Provider.use.list()

      const plugin = yield* Plugin.Service
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: [] })
      const authFile = yield* Effect.promise(() => Bun.file(path.join(Global.Path.data, "auth.json")).json())
      expect(authFile["plugin-contract-write"]).toEqual({ type: "api", key: "written-by-plugin" })
    }),
  )
})
