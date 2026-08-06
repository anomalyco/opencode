import { expect } from "bun:test"
import { LanguageModel } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { TestLLM } from "@opencode-ai/ai/testing"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { Generate } from "@opencode-ai/core/generate"
import { Integration } from "@opencode-ai/core/integration"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { ID, Info, Ref } from "@opencode-ai/core/model"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Provider } from "@opencode-ai/core/provider"
import { ProviderCompatibility } from "@opencode-ai/core/provider/compatibility"
import { Npm } from "@opencode-ai/util/npm"
import { Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"

const selected = Info.make({
  ...Info.default(Provider.ID.make("test-provider"), ID.make("gemini")),
  package: Provider.aisdk("@ai-sdk/mistral"),
})
const runtime = LanguageModel.make({ id: "gemini", provider: "test-provider", route: OpenAIChat.route })

const catalog = Layer.mock(Catalog.Service, {
  provider: {
    get: () => Effect.succeed(undefined),
    claimed: () => Effect.succeed(false),
    all: () => Effect.die("unused"),
    available: () => Effect.die("unused"),
  },
  model: {
    get: () => Effect.succeed(selected),
    all: () => Effect.die("unused"),
    available: () => Effect.die("unused"),
    default: () => Effect.die("unused"),
    configured: () => Effect.die("unused"),
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
let selections = 0
const compatibility = Layer.mock(ProviderCompatibility.Service, {
  default: () => Effect.die("unused ProviderCompatibility.default"),
  select: (requested) =>
    Effect.sync(() => {
      selections++
      return { type: "exact" as const, model: selected, requested }
    }),
})
const client = TestLLM.clientLayer.pipe(Layer.provide(TestLLM.layer({ fallback: TestLLM.text("OK", "generate") })))

const resolver = ModelResolver.layer.pipe(
  Layer.provide(Layer.mergeAll(catalog, compatibility, integrations, npm, aisdk)),
)
const generateLayer = (flush: Effect.Effect<void>) =>
  Generate.layer.pipe(
    Layer.provide(
      Layer.mergeAll(resolver, client, Layer.succeed(PluginSupervisor.Service, PluginSupervisor.Service.of({ flush }))),
    ),
  )
const it = testEffect(generateLayer(Effect.void))
const delayedIt = testEffect(generateLayer(Effect.sleep("1 second")))
const unsettledIt = testEffect(generateLayer(Effect.never))
const resolverIt = testEffect(resolver)

it.effect("loads dynamic AI SDK models", () =>
  Effect.gen(function* () {
    const generate = yield* Generate.Service
    const result = yield* generate.text({
      prompt: "Return exactly OK",
      model: Ref.make({ providerID: selected.providerID, id: selected.id }),
    })

    expect(result).toBe("OK")
  }),
)

delayedIt.effect("waits for plugin settlement before selecting a model", () =>
  Effect.gen(function* () {
    selections = 0
    const generate = yield* Generate.Service
    const result = yield* generate
      .text({
        prompt: "Return exactly OK",
        model: Ref.make({ providerID: selected.providerID, id: selected.id }),
      })
      .pipe(Effect.forkScoped({ startImmediately: true }))

    yield* TestClock.adjust("999 millis")
    expect(selections).toBe(0)
    yield* TestClock.adjust("1 millis")
    expect(yield* Fiber.join(result)).toBe("OK")
    expect(selections).toBe(1)
  }),
)

unsettledIt.effect("bounds plugin settlement before model selection", () =>
  Effect.gen(function* () {
    selections = 0
    const generate = yield* Generate.Service
    const result = yield* generate
      .text({
        prompt: "Return exactly OK",
        model: Ref.make({ providerID: selected.providerID, id: selected.id }),
      })
      .pipe(Effect.flip, Effect.forkScoped({ startImmediately: true }))

    yield* TestClock.adjust("5 seconds")
    expect(yield* Fiber.join(result)).toEqual(
      new Generate.UnavailableError({
        message: "Model catalog initialization timed out",
        service: "model.catalog",
      }),
    )
    expect(selections).toBe(0)
  }),
)

resolverIt.effect("resolves dynamic models with their catalog metadata", () =>
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const result = yield* resolver.resolve(Ref.make({ providerID: selected.providerID, id: selected.id }))

    expect(result).toEqual({
      model: runtime,
      ref: Ref.make({ providerID: selected.providerID, id: selected.id }),
      requested: Ref.make({ providerID: selected.providerID, id: selected.id }),
      via: "exact",
      capabilities: selected.capabilities,
      cost: selected.cost,
    })
  }),
)
