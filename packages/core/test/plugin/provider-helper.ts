import { Npm } from "@opencode-ai/core/npm"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"

export const fixtureProvider = new URL("./fixtures/provider-factory.ts", import.meta.url).href
const locationLayer = Layer.succeed(Location.Service, Location.Service.of({ directory: "test" }))

export const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: Option.none<string>() }),
    install: () => Effect.void,
    which: () => Effect.succeed(Option.none<string>()),
  }),
)

export const catalogLayer = Layer.succeed(
  Catalog.Service,
  Catalog.Service.of({
    loader: () => Effect.die("unexpected catalog.loader"),
    provider: {
      get: () => Effect.die("unexpected provider.get"),
      all: () => Effect.succeed([]),
      available: () => Effect.succeed([]),
    },
    model: {
      get: () => Effect.die("unexpected model.get"),
      all: () => Effect.succeed([]),
      available: () => Effect.succeed([]),
      default: () => Effect.succeed(Option.none<ModelV2.Info>()),
      setDefault: () => Effect.die("unexpected model.setDefault"),
      small: () => Effect.succeed(Option.none<ModelV2.Info>()),
    },
  }),
)

export const it = testEffect(
  Catalog.layer.pipe(
    Layer.provideMerge(PluginV2.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(locationLayer),
    Layer.provideMerge(npmLayer),
  ),
)

export function provider(providerID: string, options?: Partial<ProviderV2.Info>) {
  return new ProviderV2.Info({
    ...ProviderV2.Info.empty(ProviderV2.ID.make(providerID)),
    endpoint: {
      type: "aisdk",
      package: "test-provider",
    },
    ...options,
    options: {
      headers: {},
      body: {},
      aisdk: {
        provider: {},
        request: {},
      },
      ...options?.options,
    },
  })
}

export function model(providerID: string, modelID: string, options?: Partial<ModelV2.Info>) {
  return new ModelV2.Info({
    ...ModelV2.Info.empty(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
    apiID: ModelV2.ID.make(modelID),
    endpoint: {
      type: "aisdk",
      package: "test-provider",
    },
    ...options,
    options: {
      headers: {},
      body: {},
      aisdk: {
        provider: {},
        request: {},
      },
      ...options?.options,
    },
  })
}

export function withEnv<A, E, R>(vars: Record<string, string | undefined>, fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(vars)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return previous
    }),
    () => fx(),
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )
}

export function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

export function expectPluginRegistered(ids: string[], id: string) {
  expect(ids).toContain(PluginV2.ID.make(id))
}
