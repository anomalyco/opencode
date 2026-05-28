import { describe, expect } from "bun:test"
import { Directory } from "@/acp-next/directory"
import { Command } from "@/command"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider/provider"
import { Effect, Layer } from "effect"
import { it } from "../lib/effect"

const command = (name: string): Command.Info => ({
  name,
  source: "command",
  template: `run ${name}`,
  hints: [],
})

const model = (providerID: ProviderID, id: string, variants?: Directory.ModelVariants): Provider.Model => ({
  id: ModelID.make(id),
  providerID,
  api: {
    id,
    url: "https://example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  name: id,
  family: "test",
  capabilities: {
    temperature: true,
    reasoning: Boolean(variants),
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
  },
  limit: {
    context: 128000,
    output: 4096,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
  ...(variants ? { variants } : {}),
})

const snapshot = (directory: string) => {
  const providerID = ProviderID.make(`provider-${directory}`)
  const modelID = ModelID.make(`model-${directory}`)
  const providers = {
    [providerID]: {
      id: providerID,
      name: `Provider ${directory}`,
      source: "config",
      env: [],
      options: {},
      models: {
        [modelID]: model(providerID, modelID, {
          low: { reasoningEffort: "low" },
          high: { reasoningEffort: "high" },
        }),
        [ModelID.make(`plain-${directory}`)]: model(providerID, `plain-${directory}`),
      },
    },
  } satisfies Record<ProviderID, Provider.Info>

  return Directory.build({
    directory,
    providers,
    modes: [
      { id: "build", name: `build-${directory}` },
      { id: "plan", name: `plan-${directory}`, description: "plan first" },
    ],
    defaultModeID: "build",
    commands: [command(`init-${directory}`), command(`review-${directory}`)],
    defaultModel: { providerID, modelID },
  })
}

const fakeLayer = (calls: string[]) =>
  Directory.layer.pipe(
    Layer.provide(
      Layer.succeed(
        Directory.Loader,
        Directory.Loader.of({
          load: (directory) =>
            Effect.sync(() => {
              calls.push(directory)
              return snapshot(directory)
            }),
        }),
      ),
    ),
  )

describe("ACP next directory snapshot", () => {
  it.effect("two concurrent callers share one load", () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const directory = yield* Directory.Service
      const [first, second] = yield* Effect.all([directory.get("alpha"), directory.get("alpha")], {
        concurrency: "unbounded",
      })

      expect(calls).toEqual(["alpha"])
      expect(first).toBe(second)
    }).pipe(Effect.provide(fakeLayer(calls)))
  })

  it.effect("warm calls use cached data", () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const directory = yield* Directory.Service
      const first = yield* directory.get("alpha")
      const second = yield* directory.get("alpha")

      expect(calls).toEqual(["alpha"])
      expect(first).toBe(second)
    }).pipe(Effect.provide(fakeLayer(calls)))
  })

  it.effect("different directories get different snapshots", () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const directory = yield* Directory.Service
      const [alpha, beta] = yield* Effect.all([directory.get("alpha"), directory.get("beta")], {
        concurrency: "unbounded",
      })

      expect(calls.toSorted()).toEqual(["alpha", "beta"])
      expect(alpha.directory).toBe("alpha")
      expect(beta.directory).toBe("beta")
      expect(alpha.defaultModel?.providerID).not.toBe(beta.defaultModel?.providerID)
    }).pipe(Effect.provide(fakeLayer(calls)))
  })

  it.effect("model variant lookup works", () =>
    Effect.gen(function* () {
      const directory = yield* Directory.Service
      const alpha = yield* directory.get("alpha")
      const model = alpha.defaultModel!

      expect(directory.variants(alpha, model)).toEqual({
        low: { reasoningEffort: "low" },
        high: { reasoningEffort: "high" },
      })
      expect(directory.variants(alpha, { ...model, modelID: ModelID.make("missing") })).toBeUndefined()
    }).pipe(Effect.provide(fakeLayer([]))),
  )

  it.effect("commands and modes are included", () =>
    Effect.gen(function* () {
      const directory = yield* Directory.Service
      const alpha = yield* directory.get("alpha")

      expect(alpha.availableCommands.map((item) => item.name)).toEqual(["init-alpha", "review-alpha"])
      expect(alpha.availableModes).toEqual([
        { id: "build", name: "build-alpha" },
        { id: "plan", name: "plan-alpha", description: "plan first" },
      ])
      expect(alpha.defaultModeID).toBe("build")
    }).pipe(Effect.provide(fakeLayer([]))),
  )

  it.effect("falls back when the default mode is not available", () =>
    Effect.sync(() => {
      expect(
        Directory.build({
          directory: "alpha",
          providers: {},
          modes: [
            { id: "build", name: "Build" },
            { id: "plan", name: "Plan" },
          ],
          defaultModeID: "hidden",
          commands: [],
        }).defaultModeID,
      ).toBe("build")
    }),
  )
})
