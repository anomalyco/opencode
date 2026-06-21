import { describe, expect } from "bun:test"
import { Effect, Layer, Option, DateTime } from "effect"
import { ModelV2 } from "../src/model"
import { ProviderV2 } from "../src/provider"
import { SessionV2 } from "../src/session"
import { SessionStore } from "../src/session/store"
import { SessionMessage } from "../src/session/message"
import { SessionRunnerModel } from "../src/session/runner/model"
import { Config } from "../src/config"
import { Catalog } from "../src/catalog"
import { Credential } from "../src/credential"
import { Integration } from "../src/integration"
import { PluginBoot } from "../src/plugin/boot"
import { AbsolutePath } from "../src/schema"
import { it } from "./lib/effect"
import { ProjectV2 } from "../src/project"

const fastModelRef = { id: ModelV2.ID.make("fast-model"), providerID: ProviderV2.ID.make("test-provider") }
const complexModelRef = { id: ModelV2.ID.make("complex-model"), providerID: ProviderV2.ID.make("test-provider") }

const makeModelInfo = (id: string) =>
  new ModelV2.Info({
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.make("test-provider"),
    name: id,
    api: { id: ModelV2.ID.make(id + "-api"), type: "aisdk", package: "@ai-sdk/openai" },
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    request: { headers: {}, body: {}, generation: {} },
    variants: [],
    time: { released: DateTime.makeUnsafe(0) },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 100, output: 20 },
  })

const boot = Layer.succeed(
  PluginBoot.Service,
  PluginBoot.Service.of({
    wait: () => Effect.void,
  })
)

const credentials = Layer.succeed(
  Credential.Service,
  Credential.Service.of({
    get: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  } as any)
)

const integrations = Layer.succeed(
  Integration.Service,
  Integration.Service.of({
    connection: {
      forIntegration: () => Effect.void
    }
  } as any)
)

const catalog = Layer.succeed(
  Catalog.Service,
  Catalog.Service.of({
    model: {
      get: (providerID: any, modelID: any) => Effect.succeed(makeModelInfo(modelID)),
      default: () => Effect.succeed(Option.none()),
      available: () => Effect.succeed([]),
    }
  } as any)
)

describe("Adaptive Model Router", () => {
  it.effect("routes to fast model on simple/short user prompt", () =>
    Effect.gen(function* () {
      const configEntries = [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            personal_profile: {
              adaptive_routing: {
                enabled: true,
                fast_model: fastModelRef,
                complex_model: complexModelRef,
              }
            }
          })
        })
      ]

      const configLayer = Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () => Effect.sync(() => configEntries),
        })
      )

      // 10-word simple prompt
      const sessionMessages: SessionMessage.Message[] = [
        new SessionMessage.User({
          id: SessionMessage.ID.create(),
          type: "user",
          text: "What is 2 + 2? Please answer in one word.",
          files: [],
          agents: [],
          time: { created: DateTime.makeUnsafe(0) },
        })
      ]

      const storeLayer = Layer.succeed(
        SessionStore.Service,
        SessionStore.Service.of({
          context: () => Effect.sync(() => sessionMessages),
        } as any)
      )

      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_test"),
        projectID: ProjectV2.ID.global,
        title: "test",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const testLayer = SessionRunnerModel.locationLayer.pipe(
        Layer.provide(boot),
        Layer.provide(credentials),
        Layer.provide(integrations),
        Layer.provide(catalog),
        Layer.provide(configLayer),
        Layer.provide(storeLayer)
      )

      const runner = yield* SessionRunnerModel.Service.pipe(Effect.provide(testLayer))
      const resolved = yield* runner.resolve(session)
      expect(resolved.id as string).toBe("fast-model-api")
    })
  )

  it.effect("routes to complex model on prompt asking to refactor", () =>
    Effect.gen(function* () {
      const configEntries = [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            personal_profile: {
              adaptive_routing: {
                enabled: true,
                fast_model: fastModelRef,
                complex_model: complexModelRef,
              }
            }
          })
        })
      ]

      const configLayer = Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () => Effect.sync(() => configEntries),
        })
      )

      // Short prompt but contains "refactor" keyword
      const sessionMessages: SessionMessage.Message[] = [
        new SessionMessage.User({
          id: SessionMessage.ID.create(),
          type: "user",
          text: "Can you refactor this function?",
          files: [],
          agents: [],
          time: { created: DateTime.makeUnsafe(0) },
        })
      ]

      const storeLayer = Layer.succeed(
        SessionStore.Service,
        SessionStore.Service.of({
          context: () => Effect.sync(() => sessionMessages),
        } as any)
      )

      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_test"),
        projectID: ProjectV2.ID.global,
        title: "test",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const testLayer = SessionRunnerModel.locationLayer.pipe(
        Layer.provide(boot),
        Layer.provide(credentials),
        Layer.provide(integrations),
        Layer.provide(catalog),
        Layer.provide(configLayer),
        Layer.provide(storeLayer)
      )

      const runner = yield* SessionRunnerModel.Service.pipe(Effect.provide(testLayer))
      const resolved = yield* runner.resolve(session)
      expect(resolved.id as string).toBe("complex-model-api")
    })
  )

  it.effect("routes to complex model on long prompt (> 150 words)", () =>
    Effect.gen(function* () {
      const configEntries = [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            personal_profile: {
              adaptive_routing: {
                enabled: true,
                fast_model: fastModelRef,
                complex_model: complexModelRef,
              }
            }
          })
        })
      ]

      const configLayer = Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () => Effect.sync(() => configEntries),
        })
      )

      // Prompt with 160 words
      const words = Array.from({ length: 160 }, (_, i) => `word${i}`)
      const text = words.join(" ")

      const sessionMessages: SessionMessage.Message[] = [
        new SessionMessage.User({
          id: SessionMessage.ID.create(),
          type: "user",
          text,
          files: [],
          agents: [],
          time: { created: DateTime.makeUnsafe(0) },
        })
      ]

      const storeLayer = Layer.succeed(
        SessionStore.Service,
        SessionStore.Service.of({
          context: () => Effect.sync(() => sessionMessages),
        } as any)
      )

      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_test"),
        projectID: ProjectV2.ID.global,
        title: "test",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const testLayer = SessionRunnerModel.locationLayer.pipe(
        Layer.provide(boot),
        Layer.provide(credentials),
        Layer.provide(integrations),
        Layer.provide(catalog),
        Layer.provide(configLayer),
        Layer.provide(storeLayer)
      )

      const runner = yield* SessionRunnerModel.Service.pipe(Effect.provide(testLayer))
      const resolved = yield* runner.resolve(session)
      expect(resolved.id as string).toBe("complex-model-api")
    })
  )

  it.effect("falls back to session.model when adaptive routing is disabled", () =>
    Effect.gen(function* () {
      const configEntries = [
        new Config.Document({
          type: "document",
          info: new Config.Info({
            personal_profile: {
              adaptive_routing: {
                enabled: false,
                fast_model: fastModelRef,
                complex_model: complexModelRef,
              }
            }
          })
        })
      ]

      const configLayer = Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () => Effect.sync(() => configEntries),
        })
      )

      // Even if it has "refactor" keyword, it shouldn't route to complex model
      const sessionMessages: SessionMessage.Message[] = [
        new SessionMessage.User({
          id: SessionMessage.ID.create(),
          type: "user",
          text: "Can you refactor this function?",
          files: [],
          agents: [],
          time: { created: DateTime.makeUnsafe(0) },
        })
      ]

      const storeLayer = Layer.succeed(
        SessionStore.Service,
        SessionStore.Service.of({
          context: () => Effect.sync(() => sessionMessages),
        } as any)
      )

      const session = SessionV2.Info.make({
        id: SessionV2.ID.make("ses_test"),
        projectID: ProjectV2.ID.global,
        title: "test",
        model: { id: ModelV2.ID.make("custom-session-model"), providerID: ProviderV2.ID.make("test-provider") },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })

      const testLayer = SessionRunnerModel.locationLayer.pipe(
        Layer.provide(boot),
        Layer.provide(credentials),
        Layer.provide(integrations),
        Layer.provide(catalog),
        Layer.provide(configLayer),
        Layer.provide(storeLayer)
      )

      const runner = yield* SessionRunnerModel.Service.pipe(Effect.provide(testLayer))
      const resolved = yield* runner.resolve(session)
      expect(resolved.id as string).toBe("custom-session-model-api")
    })
  )
})
