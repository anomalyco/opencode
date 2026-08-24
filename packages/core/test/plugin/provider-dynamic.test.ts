import { Npm } from "@opencode-ai/util/npm"
import { describe, expect } from "bun:test"
import { Cause, Effect, Layer } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { AISDK } from "@opencode-ai/core/aisdk"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { DynamicProviderPlugin } from "@opencode-ai/core/plugin/provider/dynamic"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const fixtureProvider = new URL("./fixtures/provider-factory.ts", import.meta.url).href
const fixtureProviderPath = fileURLToPath(fixtureProvider)
const it = testEffect(PluginTestLayer)
const itWithAISDK = testEffect(Layer.mergeAll(PluginTestLayer, AppNodeBuilder.build(AISDK.node)))

function npmEntrypoint(entrypoint?: string) {
  return Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint }),
    resolve: () => Effect.succeed({ directory: "", entrypoint }),
    which: () => Effect.undefined,
  })
}

const addPlugin = Effect.fn(function* (npm?: Npm.Interface) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* DynamicProviderPlugin.effect(host).pipe(Effect.provideService(Npm.Service, npm ?? (yield* Npm.Service)))
})

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
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("custom"), Model.ID.make("test-model")),
          modelID: Model.ID.make("test-model"),
          package: Provider.aisdk(fixtureProvider),
        }),
        package: fixtureProvider,
        options: { name: "custom", marker: "dynamic" },
      })
      expect(result.sdk.options).toEqual({ marker: "dynamic", name: "custom" })
      expect(result.sdk.languageModel("x")).toEqual({ modelID: "x", options: { marker: "dynamic", name: "custom" } })
    }),
  )

  it.effect("does not override an SDK already supplied by an earlier plugin", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const sdk = { marker: "existing" }
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("custom"), Model.ID.make("test-model")),
          modelID: Model.ID.make("test-model"),
          package: Provider.aisdk(fixtureProvider),
        }),
        package: fixtureProvider,
        options: { name: "custom", marker: "dynamic" },
        sdk,
      })
      expect(result.sdk).toBe(sdk)
    }),
  )

  it.effect("injects the provider ID as the SDK factory name", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("custom-provider"), Model.ID.make("test-model")),
          modelID: Model.ID.make("test-model"),
          package: Provider.aisdk(fixtureProvider),
        }),
        package: fixtureProvider,
        options: { name: "custom-provider", marker: "dynamic" },
      })
      expect(result.sdk.options).toEqual({ marker: "dynamic", name: "custom-provider" })
    }),
  )

  it.effect("loads npm packages through their resolved import entrypoint", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin(npmEntrypoint(fixtureProviderPath))
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("npm-provider"), Model.ID.make("test-model")),
          modelID: Model.ID.make("test-model"),
          package: "aisdk:fixture-provider",
        }),
        package: "fixture-provider",
        options: { name: "npm-provider", marker: "npm" },
      })
      expect(result.sdk.languageModel("x")).toEqual({ modelID: "x", options: { marker: "npm", name: "npm-provider" } })
    }),
  )

  itWithAISDK.effect("wraps missing npm entrypoint failures as AISDK init errors", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin(npmEntrypoint())
      const exit = yield* aisdk
        .language(
          Model.Info.make({
            ...Model.Info.default(Provider.ID.make("missing-entrypoint"), Model.ID.make("alias")),
            modelID: Model.ID.make("alias"),
            package: "aisdk:fixture-provider",
          }),
        )
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.prettyErrors(exit.cause).join("\n")).toContain("AISDK.InitError")
    }),
  )

  itWithAISDK.effect("wraps dynamic import failures as AISDK init errors", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const exit = yield* aisdk
        .language(
          Model.Info.make({
            ...Model.Info.default(Provider.ID.make("bad-import"), Model.ID.make("alias")),
            modelID: Model.ID.make("alias"),
            package: "aisdk:file:///missing/provider-factory.js",
          }),
        )
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.prettyErrors(exit.cause).join("\n")).toContain("AISDK.InitError")
    }),
  )

  itWithAISDK.live("wraps missing provider factory exports as AISDK init errors", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const tmp = yield* tempEntrypoint("export const notAProviderFactory = true\n")
      yield* addPlugin(npmEntrypoint(tmp.entrypoint))
      const exit = yield* aisdk
        .language(
          Model.Info.make({
            ...Model.Info.default(Provider.ID.make("missing-factory"), Model.ID.make("alias")),
            modelID: Model.ID.make("alias"),
            package: "aisdk:fixture-provider",
          }),
        )
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.prettyErrors(exit.cause).join("\n")).toContain("AISDK.InitError")
    }),
  )

  itWithAISDK.effect("uses the model modelID for the default language model", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const language = yield* aisdk.language(
        Model.Info.make({
          ...Model.Info.default(Provider.ID.make("custom"), Model.ID.make("alias")),
          modelID: Model.ID.make("test-model-api"),
          package: Provider.aisdk(fixtureProvider),
        }),
      )
      expect(language).toMatchObject({ modelID: "test-model-api", options: { name: "custom" } })
    }),
  )
})
