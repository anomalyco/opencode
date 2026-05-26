import { Npm } from "@opencode-ai/core/npm"
import { describe, expect } from "bun:test"
import { Cause, Effect, Layer, Option } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { DynamicProviderPlugin } from "@opencode-ai/core/plugin/provider/dynamic"
import { testEffect } from "../lib/effect"
import { fixtureProvider, it, model, npmLayer } from "./provider-helper"

const fixtureProviderPath = fileURLToPath(fixtureProvider)
const itWithAISDK = testEffect(AISDK.layer.pipe(Layer.provideMerge(PluginV2.defaultLayer)))

function npmEntrypointLayer(entrypoint: Option.Option<string>) {
  return Layer.succeed(
    Npm.Service,
    Npm.Service.of({
      add: () => Effect.succeed({ directory: "", entrypoint }),
      install: () => Effect.void,
      which: () => Effect.succeed(Option.none<string>()),
    }),
  )
}

function dynamicPlugin(layer = npmLayer) {
  return { id: DynamicProviderPlugin.id, effect: DynamicProviderPlugin.effect.pipe(Effect.provide(layer)) }
}

function tempEntrypoint(source: string) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-provider-dynamic-"))
      const entrypoint = path.join(directory, "provider.mjs")
      await Bun.write(entrypoint, source)
      return { directory, entrypoint }
    }),
    (tmp) => Effect.promise(() => fs.rm(tmp.directory, { recursive: true, force: true })),
  )
}

describe("DynamicProviderPlugin", () => {
  it.effect("creates an SDK from a provider factory export", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(dynamicPlugin())
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom", "test-model"),
          package: fixtureProvider,
          options: { name: "custom", marker: "dynamic" },
        },
        {},
      )
      expect(result.sdk.options).toEqual({ marker: "dynamic", name: "custom" })
      expect(result.sdk.languageModel("x")).toEqual({ modelID: "x", options: { marker: "dynamic", name: "custom" } })
    }),
  )

  it.effect("does not override an SDK already supplied by an earlier plugin", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const sdk = { marker: "existing" }
      yield* plugin.add(dynamicPlugin())
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom", "test-model"),
          package: fixtureProvider,
          options: { name: "custom", marker: "dynamic" },
        },
        { sdk },
      )
      expect(result.sdk).toBe(sdk)
    }),
  )

  it.effect("injects the provider ID as the SDK factory name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(dynamicPlugin())
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("custom-provider", "test-model"),
          package: fixtureProvider,
          options: { name: "custom-provider", marker: "dynamic" },
        },
        {},
      )
      expect(result.sdk.options).toEqual({ marker: "dynamic", name: "custom-provider" })
    }),
  )

  it.effect("loads npm packages through their resolved import entrypoint", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(dynamicPlugin(npmEntrypointLayer(Option.some(fixtureProviderPath))))
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("npm-provider", "test-model"),
          package: "fixture-provider",
          options: { name: "npm-provider", marker: "npm" },
        },
        {},
      )
      expect(result.sdk.languageModel("x")).toEqual({ modelID: "x", options: { marker: "npm", name: "npm-provider" } })
    }),
  )

  itWithAISDK.effect("wraps missing npm entrypoint failures as AISDK init errors", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* plugin.add(dynamicPlugin(npmEntrypointLayer(Option.none<string>())))
      const exit = yield* aisdk
        .language(model("missing-entrypoint", "alias", { endpoint: { type: "aisdk", package: "fixture-provider" } }))
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.prettyErrors(exit.cause).join("\n")).toContain("AISDK.InitError")
    }),
  )

  itWithAISDK.effect("wraps dynamic import failures as AISDK init errors", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* plugin.add(dynamicPlugin())
      const exit = yield* aisdk
        .language(
          model("bad-import", "alias", { endpoint: { type: "aisdk", package: "file:///missing/provider-factory.js" } }),
        )
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.prettyErrors(exit.cause).join("\n")).toContain("AISDK.InitError")
    }),
  )

  itWithAISDK.live("wraps missing provider factory exports as AISDK init errors", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const tmp = yield* tempEntrypoint("export const notAProviderFactory = true\n")
      yield* plugin.add(dynamicPlugin(npmEntrypointLayer(Option.some(tmp.entrypoint))))
      const exit = yield* aisdk
        .language(model("missing-factory", "alias", { endpoint: { type: "aisdk", package: "fixture-provider" } }))
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.prettyErrors(exit.cause).join("\n")).toContain("AISDK.InitError")
    }),
  )

  itWithAISDK.effect("uses the model apiID for the default language model", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* plugin.add(dynamicPlugin())
      const language = yield* aisdk.language(
        model("custom", "alias", {
          apiID: ModelV2.ID.make("test-model-api"),
          endpoint: { type: "aisdk", package: fixtureProvider },
        }),
      )
      expect(language).toMatchObject({ modelID: "test-model-api", options: { name: "custom" } })
    }),
  )
})
