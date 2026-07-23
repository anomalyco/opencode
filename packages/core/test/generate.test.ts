import { expect } from "bun:test"
import { LLMClient, LLMEvent, LLMResponse, Model } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { Generate } from "@opencode-ai/core/generate"
import { Integration } from "@opencode-ai/core/integration"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Npm } from "@opencode-ai/util/npm"
import { Effect, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"

const selected = ModelV2.Info.make({
  ...ModelV2.Info.default(ProviderV2.ID.make("test-provider"), ModelV2.ID.make("gemini")),
  package: ProviderV2.aisdk("@ai-sdk/google"),
})
const runtime = Model.make({ id: "gemini", provider: "test-provider", route: OpenAIChat.route })

const catalog = Layer.mock(Catalog.Service, {
  provider: {
    get: () => Effect.succeed(undefined),
    all: () => Effect.die("unused"),
    available: () => Effect.die("unused"),
  },
  model: {
    get: () => Effect.succeed(selected),
    all: () => Effect.die("unused"),
    available: () => Effect.die("unused"),
    default: () => Effect.die("unused"),
    small: () => Effect.die("unused"),
  },
})
const integrations = Layer.mock(Integration.Service, {
  connection: {
    active: () => Effect.succeed(undefined),
    resolve: () => Effect.die("unused"),
    key: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
  },
  oauth: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    complete: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
  command: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
})
const npm = Layer.mock(Npm.Service, {
  add: () => Effect.die("unused"),
  install: () => Effect.die("unused"),
  which: () => Effect.die("unused"),
})
const aisdk = Layer.mock(AISDK.Service, {
  hook: {
    sdk: () => Effect.die("unused"),
    language: () => Effect.die("unused"),
  },
  model: () => Effect.succeed(runtime),
})
const client = Layer.mock(LLMClient.Service)({
  prepare: () => Effect.die("unused"),
  stream: () => Stream.die("unused"),
  generate: () =>
    Effect.sync(() => {
      const response = LLMResponse.fromEvents([
        LLMEvent.textStart({ id: "generate" }),
        LLMEvent.textDelta({ id: "generate", text: "OK" }),
        LLMEvent.textEnd({ id: "generate" }),
        LLMEvent.finish({ reason: { normalized: "stop" } }),
      ])
      if (!response) throw new Error("Incomplete generate response")
      return response
    }),
})

const resolver = ModelResolver.layer.pipe(Layer.provide(Layer.mergeAll(catalog, integrations, npm, aisdk)))
const it = testEffect(Generate.layer.pipe(Layer.provide(Layer.merge(resolver, client))))
const resolverIt = testEffect(resolver)

it.effect("loads dynamic AI SDK models", () =>
  Effect.gen(function* () {
    const generate = yield* Generate.Service
    const result = yield* generate.text({
      prompt: "Return exactly OK",
      model: ModelV2.Ref.make({ providerID: selected.providerID, id: selected.id }),
    })

    expect(result).toBe("OK")
  }),
)

resolverIt.effect("resolves dynamic models with their catalog metadata", () =>
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const result = yield* resolver.resolve(ModelV2.Ref.make({ providerID: selected.providerID, id: selected.id }))

    expect(result).toEqual({
      model: runtime,
      ref: ModelV2.Ref.make({ providerID: selected.providerID, id: selected.id }),
      capabilities: selected.capabilities,
      cost: selected.cost,
    })
  }),
)
