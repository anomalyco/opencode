import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Layer } from "effect"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const testStateLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(Layer.mergeAll(testStateLayer, LayerNode.compile(FSUtil.node), httpApiLayer))
const projectOptions = { config: { formatter: false, lsp: false } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

describe("catalog cold-start readiness", () => {
  it.instance(
    "serves provider and model lists only after initial plugins settle",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-opencode-directory": directory }

      // Concurrent cold-start reads must not race ahead of the initial
      // catalog-producing plugins; both responses come from the settled catalog.
      const [providerResponse, modelResponse] = yield* Effect.all(
        [request("/api/provider", { headers }), request("/api/model", { headers })],
        { concurrency: 2 },
      )

      expect(providerResponse.status).toBe(200)
      expect(modelResponse.status).toBe(200)

      const providerBody = (yield* providerResponse.json) as { data: unknown[] }
      const modelBody = (yield* modelResponse.json) as { data: unknown[] }

      // preload.ts pins OPENCODE_MODELS_PATH to test/tool/fixtures/models-api.json,
      // which contributes requesty and xai/grok-4 through the models-dev plugin.
      const providerIDs = new Set(
        providerBody.data
          .filter(isRecord)
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string"),
      )
      const modelIDs = new Set(
        modelBody.data
          .filter(isRecord)
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string"),
      )
      expect(providerIDs.has("requesty")).toBe(true)
      expect(modelIDs.has("xai/grok-4")).toBe(true)
    }),
    projectOptions,
    30000,
  )
})
