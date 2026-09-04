import { expect } from "bun:test"
import { LanguageModel, type LLMRequest } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { TestLLM } from "@opencode-ai/ai/testing"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { Generate } from "@opencode-ai/core/generate"
import { Integration } from "@opencode-ai/core/integration"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { ID, Info, Ref } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { Npm } from "@opencode-ai/util/npm"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const selected = Info.make({
  ...Info.default(Provider.ID.make("test-provider"), ID.make("gemini")),
  package: Provider.aisdk("@ai-sdk/cohere"),
})
const runtime = LanguageModel.make({ id: "gemini", provider: "test-provider", route: OpenAIChat.route })

const catalog = Layer.mock(Catalog.Service, {
  provider: {
    get: () => Effect.undefined,
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
    active: () => Effect.undefined,
    resolve: () => Effect.die("unused"),
    key: () => Effect.die("unused"),
    activate: () => Effect.die("unused"),
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
  which: () => Effect.die("unused"),
})
const aisdk = Layer.mock(AISDK.Service, {
  hook: {
    sdk: () => Effect.die("unused"),
    language: () => Effect.die("unused"),
  },
  model: () => Effect.succeed(runtime),
})
const requests: LLMRequest[] = []
const client = TestLLM.testLayer({
  transformRequest: (input) => {
    requests.push(input)
    return input
  },
  fallback: TestLLM.text("OK", "generate"),
})

const resolver = ModelResolver.layer.pipe(Layer.provide(Layer.mergeAll(catalog, integrations, npm, aisdk)))
const it = testEffect(Generate.layer.pipe(Layer.provide(Layer.merge(resolver, client))))
const resolverIt = testEffect(resolver)

it.effect("loads dynamic AI SDK models", () =>
  Effect.gen(function* () {
    const generate = yield* Generate.Service
    requests.length = 0
    const result = yield* generate.text({
      prompt: "Return exactly OK",
      model: Ref.make({ providerID: selected.providerID, id: selected.id }),
      body: { max_tokens: 321 },
    })

    expect(result).toBe("OK")
    expect(requests[0]?.http?.body).toEqual({ max_tokens: 321 })
  }),
)

resolverIt.effect("resolves dynamic models with their catalog metadata", () =>
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const result = yield* resolver.resolve(Ref.make({ providerID: selected.providerID, id: selected.id }))

    expect(result).toEqual({
      model: runtime,
      ref: Ref.make({ providerID: selected.providerID, id: selected.id }),
      capabilities: selected.capabilities,
      cost: selected.cost,
      limit: selected.limit,
    })
  }),
)
