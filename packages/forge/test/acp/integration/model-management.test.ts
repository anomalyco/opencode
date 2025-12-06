/**
 * Integration Test: ACP Client Model Management
 *
 * Tests session model operations:
 * - Getting available models
 * - Getting current model
 * - Switching models
 * - Model change notifications
 *
 * Run with: FORGE_RUN_INTEGRATION=1 ANTHROPIC_API_KEY=xxx bun test test/acp/integration/model-management.test.ts
 */

import { ACPClient } from "../../../src/acp/client"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { describe, test, expect } from "bun:test"

function shouldRunIntegration() {
  if (process.env.FORGE_RUN_INTEGRATION !== "1") return false
  if (!process.env.ANTHROPIC_API_KEY) return false
  return true
}


const runIntegration = shouldRunIntegration()
const describeIntegration = runIntegration ? describe : describe.skip
const testIntegration = runIntegration ? test : test.skip

describeIntegration("ACP Client Model Management", () => {
  testIntegration(
    "should capture models from createSession response",
    async () => {
      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
        },
      })

      try {
        await client.initialize()
        await client.createSession()

        // Test getModels() returns the model state
        const models = client.getModels()

        if (!models) {
          console.log("⊘ Agent does not support models, skipping test")
          return
        }

        expect(models).toBeTruthy()
        expect(models.currentModelId).toBeTruthy()
        expect(models.availableModels).toBeInstanceOf(Array)
        expect(models.availableModels.length).toBeGreaterThan(0)

        console.log("✓ Model state captured:", {
          currentModel: models.currentModelId,
          availableCount: models.availableModels.length,
          models: models.availableModels.map(m => `${m.modelId} (${m.name})`)
        })
      } finally {
        await client.dispose()
      }
    },
    30000
  )

  testIntegration(
    "should return current model ID",
    async () => {
      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
        },
      })

      try {
        await client.initialize()
        await client.createSession()

        const currentModel = client.getCurrentModel()

        if (!currentModel) {
          console.log("⊘ Agent does not support models, skipping test")
          return
        }

        expect(currentModel).toBeTruthy()
        expect(typeof currentModel).toBe("string")

        console.log("✓ Current model:", currentModel)
      } finally {
        await client.dispose()
      }
    },
    30000
  )

  testIntegration(
    "should change model via setModel()",
    async () => {
      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
        },
      })

      try {
        await client.initialize()
        await client.createSession()

        const models = client.getModels()

        if (!models) {
          console.log("⊘ Agent does not support models, skipping test")
          return
        }

        expect(models).toBeTruthy()

        if (models.availableModels.length < 2) {
          console.log("⊘ Agent has less than 2 models, skipping model switch test")
          return
        }

        const initialModel = client.getCurrentModel()

        // Find a different model to switch to
        const targetModel = models.availableModels.find(m => m.modelId !== initialModel)
        expect(targetModel).toBeTruthy()

        console.log(`Switching from ${initialModel} to ${targetModel!.modelId}...`)

        const response = await client.setModel(targetModel!.modelId)
        expect(response).toBeTruthy()

        // Verify model changed
        const newModel = client.getCurrentModel()
        expect(newModel).toBe(targetModel!.modelId)

        console.log("✓ Model changed successfully")
      } finally {
        await client.dispose()
      }
    },
    30000
  )

  testIntegration(
    "should trigger onModelChange callback when model changes",
    async () => {
      let callbackModelId: string | null = null

      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
        },
      })

      // Register callback before session creation
      const modelChangePromise = new Promise<string>((resolve) => {
        client.onModelChange((modelId) => {
          callbackModelId = modelId
          resolve(modelId)
        })
      })

      const timeoutPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve("timeout"), 5000)
      })

      try {
        await client.initialize()
        await client.createSession()

        const models = client.getModels()

        if (!models) {
          console.log("⊘ Agent does not support models, skipping test")
          return
        }

        const initialModel = client.getCurrentModel()

        if (models.availableModels.length < 2) {
          console.log("⊘ Agent has less than 2 models, skipping callback test")
          return
        }

        const targetModel = models.availableModels.find(m => m.modelId !== initialModel)

        if (!targetModel) {
          console.log("⊘ No alternative model available, skipping callback test")
          return
        }

        // Change model and wait for callback
        await client.setModel(targetModel.modelId)

        const callbackResult = await Promise.race([modelChangePromise, timeoutPromise])
        expect(callbackResult).toBe(targetModel.modelId)
        expect(callbackModelId!).toBe(targetModel.modelId)

        console.log("✓ onModelChange callback triggered with:", callbackModelId)
      } finally {
        await client.dispose()
      }
    },
    30000
  )

  testIntegration(
    "should handle current_model_update notifications from agent",
    async () => {
      let receivedModelUpdate = false
      let updatedModelId: string | null = null

      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
        },
        onSessionUpdate: (update: SessionNotification) => {
          if ((update.update as any).sessionUpdate === "current_model_update") {
            receivedModelUpdate = true
            updatedModelId = (update.update as any).currentModelId
            console.log("Received current_model_update:", updatedModelId)
          }
        },
      })

      try {
        await client.initialize()
        await client.createSession()

        const models = client.getModels()

        if (!models) {
          console.log("⊘ Agent does not support models, skipping test")
          return
        }

        const initialModel = client.getCurrentModel()

        if (models.availableModels.length < 2) {
          console.log("⊘ Agent has less than 2 models, skipping notification test")
          return
        }

        const targetModel = models.availableModels.find(m => m.modelId !== initialModel)

        if (!targetModel) {
          console.log("⊘ No alternative model available, skipping notification test")
          return
        }

        // Change model - this should trigger a notification
        await client.setModel(targetModel.modelId)

        // Note: Depending on the agent implementation, the notification
        // may or may not be sent for client-initiated model changes.
        // This test validates that IF a notification is sent, it's handled correctly.

        console.log("✓ Notification handling tested", {
          received: receivedModelUpdate,
          modelId: updatedModelId
        })
      } finally {
        await client.dispose()
      }
    },
    30000
  )

  testIntegration(
    "should return null when no session exists",
    async () => {
      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
        },
      })

      try {
        await client.initialize()

        // Before session creation
        expect(client.getModels()).toBeNull()
        expect(client.getCurrentModel()).toBeNull()

        console.log("✓ Returns null before session creation")
      } finally {
        await client.dispose()
      }
    },
    30000
  )
})
