/**
 * Unit Test: Model Management
 *
 * Tests model state handling and current_model_update notification translation
 * using fixtures (no live agent required)
 */

import { describe, expect, test } from "bun:test"
import type { SessionModelState } from "@agentclientprotocol/sdk"
import modelFixtures from "../fixtures/data/model-notifications.json"

describe("Model Management (unit)", () => {
  describe("SessionModelState handling", () => {
    test("should parse model state from NewSessionResponse", () => {
      const fixtureData = modelFixtures.events.find(e => e.type === "initial_session_models")
      expect(fixtureData).toBeTruthy()

      const models = fixtureData!.models as SessionModelState

      // Verify structure
      expect(models.currentModelId).toBeTruthy()
      expect(typeof models.currentModelId).toBe("string")
      expect(models.availableModels).toBeInstanceOf(Array)
      expect(models.availableModels.length).toBeGreaterThan(0)

      // Verify model details
      models.availableModels.forEach(model => {
        expect(model.modelId).toBeTruthy()
        expect(typeof model.modelId).toBe("string")
        expect(model.name).toBeTruthy()
        expect(typeof model.name).toBe("string")
      })
    })

    test("should validate all model IDs are strings", () => {
      const fixtureData = modelFixtures.events.find(e => e.type === "initial_session_models")
      const models = fixtureData!.models as SessionModelState

      expect(typeof models.currentModelId).toBe("string")
      models.availableModels.forEach(model => {
        expect(typeof model.modelId).toBe("string")
        expect(typeof model.name).toBe("string")
      })
    })

    test("should have current model in available models", () => {
      const fixtureData = modelFixtures.events.find(e => e.type === "initial_session_models")
      const models = fixtureData!.models as SessionModelState

      const currentModelExists = models.availableModels.some(
        m => m.modelId === models.currentModelId
      )
      expect(currentModelExists).toBe(true)
    })

    test("should include model descriptions when available", () => {
      const fixtureData = modelFixtures.events.find(e => e.type === "initial_session_models")
      const models = fixtureData!.models as SessionModelState

      models.availableModels.forEach(model => {
        // Description is optional per spec
        if (model.description !== undefined) {
          expect(typeof model.description).toBe("string")
        }
      })
    })
  })

  describe("current_model_update notifications", () => {
    test("should parse model change notifications", () => {
      const modelUpdates = modelFixtures.events.filter(e => e.type === "current_model_update")

      expect(modelUpdates.length).toBeGreaterThan(0)

      modelUpdates.forEach(update => {
        expect(update.notification?.sessionId).toBeTruthy()
        expect(update.notification?.update.sessionUpdate).toBe("current_model_update")
        expect(typeof update.notification?.update.currentModelId).toBe("string")
        expect(update.notification?.update.currentModelId?.length).toBeGreaterThan(0)
      })
    })

    test("all model updates should have valid structure", () => {
      const modelUpdates = modelFixtures.events.filter(e => e.type === "current_model_update")

      expect(modelUpdates.length).toBeGreaterThan(0)

      modelUpdates.forEach(update => {
        expect(update.notification?.sessionId).toBeTruthy()
        expect(update.notification?.update.sessionUpdate).toBe("current_model_update")
        expect(typeof update.notification?.update.currentModelId).toBe("string")
        expect(update.notification?.update.currentModelId.length).toBeGreaterThan(0)
      })
    })
  })

  describe("model state transitions", () => {
    test("should validate model transition sequence", () => {
      const modelUpdates = modelFixtures.events.filter(e => e.type === "current_model_update")

      // Verify we have a sequence
      if (modelUpdates.length > 0) {
        // Extract model IDs in order
        const modelSequence = modelUpdates.map(e => e.notification?.update.currentModelId)

        // Verify models are valid strings
        modelSequence.forEach(modelId => {
          expect(typeof modelId).toBe("string")
          if (modelId) expect(modelId.length).toBeGreaterThan(0)
        })
      }
    })

    test("should handle models as ModelId type", () => {
      const fixtureData = modelFixtures.events.find(e => e.type === "initial_session_models")
      const models = fixtureData!.models as SessionModelState

      // Type assertion to verify modelId compatibility (modelId is just a string)
      const currentModel: string = models.currentModelId
      expect(typeof currentModel).toBe("string")

      models.availableModels.forEach(model => {
        const modelId: string = model.modelId
        expect(typeof modelId).toBe("string")
      })
    })
  })

  describe("model metadata", () => {
    test("should include model names", () => {
      const fixtureData = modelFixtures.events.find(e => e.type === "initial_session_models")
      const models = fixtureData!.models as SessionModelState

      models.availableModels.forEach(model => {
        expect(model.name).toBeTruthy()
        expect(model.name.length).toBeGreaterThan(0)
      })
    })

    test("should have unique model IDs", () => {
      const fixtureData = modelFixtures.events.find(e => e.type === "initial_session_models")
      const models = fixtureData!.models as SessionModelState

      const modelIds = models.availableModels.map(m => m.modelId)
      const uniqueIds = new Set(modelIds)

      expect(modelIds.length).toBe(uniqueIds.size)
    })
  })
})
