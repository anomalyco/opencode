/**
 * Fixture Generator for ACP Integration Tests
 *
 * This script spawns claude-code-acp and captures
 * SessionNotification responses to save as JSON fixtures for unit tests.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=xxx bun test/acp/fixtures/generate.ts
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY environment variable must be set
 *   - claude-code-acp will be spawned via npx
 */

import { ACPClient } from "../../../src/acp/client"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { writeFile, mkdir } from "fs/promises"
import { join } from "path"

const FIXTURES_DIR = join(import.meta.dir, "data")

interface CapturedFixture {
  description: string
  prompt: string
  notifications: SessionNotification[]
}

/**
 * Capture SessionNotifications for a given prompt
 */
async function captureNotifications(
  client: ACPClient.Instance,
  sessionId: string,
  prompt: string,
  description: string,
  collector: SessionNotification[]
): Promise<CapturedFixture> {
  collector.length = 0

  console.log(`\n📝 Capturing: ${description}`)
  console.log(`   Prompt: "${prompt}"`)

  await client.sendPrompt(sessionId, prompt)
  console.log(`   ✓ Captured ${collector.length} notifications`)

  return {
    description,
    prompt,
    notifications: [...collector]
  }
}

/**
 * Save fixture to JSON file
 */
async function saveFixture(name: string, fixture: CapturedFixture): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true })

  const filePath = join(FIXTURES_DIR, `${name}.json`)
  await writeFile(
    filePath,
    JSON.stringify(fixture, null, 2),
    "utf-8"
  )

  console.log(`   💾 Saved to ${filePath}`)
}

/**
 * Main fixture generation flow
 */
async function main() {
  console.log("=== ACP Fixture Generator ===\n")

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ Error: ANTHROPIC_API_KEY environment variable is required")
    console.error("   Usage: ANTHROPIC_API_KEY=xxx bun test/acp/fixtures/generate.ts")
    process.exit(1)
  }

  console.log("🚀 Spawning claude-code-acp...")

  const collector: SessionNotification[] = []

  // Create client
  const client = await ACPClient.create({
    command: "npx",
    args: ["@zed-industries/claude-code-acp"],
    cwd: process.cwd(),
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
    },
    onSessionUpdate: (update: SessionNotification) => {
      collector.push(update)
      // Log updates during capture
      const updateType = update.update.sessionUpdate
      if (updateType === "agent_message_chunk" && update.update.content.type === "text") {
        process.stdout.write(update.update.content.text)
      } else if (updateType === "tool_call") {
        console.log(`\n   [Tool] ${update.update.title} (${update.update.status})`)
      }
    }
  })

  try {
    // Initialize
    console.log("\n🔌 Initializing connection...")
    const initResponse = await client.initialize()
    console.log(`✓ Connected to ${initResponse.agentInfo?.name} v${initResponse.agentInfo?.version}`)

    // Create session
    console.log("\n📦 Creating session...")
    const sessionResponse = await client.createSession()
    const sessionId = sessionResponse.sessionId
    console.log(`✓ Session created: ${sessionId}`)

    // Generate mode fixtures
    console.log("\n🎭 Generating mode fixtures...")
    const modes = client.getModes()
    if (modes) {
      const modeFixture = {
        description: "Session mode notifications - mode state and mode change updates",
        events: [
          {
            type: "initial_session_modes",
            description: "Session modes from NewSessionResponse",
            modes: modes
          }
        ] as any[]
      }

      // Add mode change notifications if multiple modes available
      if (modes.availableModes.length > 1) {
        const initialMode = modes.currentModeId
        const targetMode = modes.availableModes.find(m => m.id !== initialMode)

        if (targetMode) {
          console.log(`   Switching mode from ${initialMode} to ${targetMode.id}...`)
          await client.setMode(targetMode.id)

          modeFixture.events.push({
            type: "current_mode_update",
            description: `Notification when mode changes to '${targetMode.id}'`,
            notification: {
              sessionId: sessionId,
              update: {
                sessionUpdate: "current_mode_update",
                currentModeId: targetMode.id
              }
            }
          })

          // Switch back to initial mode
          console.log(`   Switching mode back to ${initialMode}...`)
          await client.setMode(initialMode)

          modeFixture.events.push({
            type: "current_mode_update",
            description: `Notification when mode changes back to '${initialMode}'`,
            notification: {
              sessionId: sessionId,
              update: {
                sessionUpdate: "current_mode_update",
                currentModeId: initialMode
              }
            }
          })
        }
      }

      await saveFixture("mode-notifications", modeFixture)
      console.log("   ✓ Mode fixtures generated")
    } else {
      console.log("   ⊘ Agent does not support modes, skipping mode fixtures")
    }

    // Generate model fixtures
    console.log("\n🤖 Generating model fixtures...")
    const models = client.getModels()
    if (models) {
      const modelFixture = {
        description: "Session model notifications - model state and model change updates",
        events: [
          {
            type: "initial_session_models",
            description: "Session models from NewSessionResponse",
            models: models
          }
        ] as any[]
      }

      // Add model change notifications if multiple models available
      if (models.availableModels.length > 1) {
        const initialModel = models.currentModelId
        const targetModel = models.availableModels.find(m => m.modelId !== initialModel)

        if (targetModel) {
          console.log(`   Switching model from ${initialModel} to ${targetModel.modelId}...`)
          await client.setModel(targetModel.modelId)

          modelFixture.events.push({
            type: "current_model_update",
            description: `Notification when model changes to '${targetModel.modelId}'`,
            notification: {
              sessionId: sessionId,
              update: {
                sessionUpdate: "current_model_update",
                currentModelId: targetModel.modelId
              }
            }
          })

          // Switch back to initial model
          console.log(`   Switching model back to ${initialModel}...`)
          await client.setModel(initialModel)

          modelFixture.events.push({
            type: "current_model_update",
            description: `Notification when model changes back to '${initialModel}'`,
            notification: {
              sessionId: sessionId,
              update: {
                sessionUpdate: "current_model_update",
                currentModelId: initialModel
              }
            }
          })
        }
      }

      await saveFixture("model-notifications", modelFixture)
      console.log("   ✓ Model fixtures generated")
    } else {
      console.log("   ⊘ Agent does not support models, skipping model fixtures")
    }

    // Capture fixtures for different scenarios
    const fixtures: Array<{ name: string; prompt: string; description: string }> = [
      {
        name: "simple-text",
        prompt: "What is 2 + 2? Please respond with just the number.",
        description: "Simple text response without tool calls"
      },
      {
        name: "text-with-reasoning",
        prompt: "ultrathink: Explain step by step how to calculate 5 * 7. Show your thinking.",
        description: "Text response with forced reasoning/thought chunks (ultrathink trigger)"
      },
      {
        name: "multiple-chunks",
        prompt: "Count from 1 to 10, with each number on a separate line.",
        description: "Multiple text chunks streaming"
      }
    ]

    console.log(`\n📋 Capturing ${fixtures.length} fixture scenarios...\n`)

    for (const { name, prompt, description } of fixtures) {
      const fixture = await captureNotifications(client, sessionId, prompt, description, collector)
      await saveFixture(name, fixture)

      // Small delay between prompts
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.log("\n✅ All fixtures generated successfully!")
    console.log(`\n📁 Fixtures saved to: ${FIXTURES_DIR}`)

  } catch (error) {
    console.error("\n❌ Error generating fixtures:", error)
    throw error
  } finally {
    console.log("\n🧹 Cleaning up...")
    await client.dispose()
    console.log("✓ Client disposed")
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("\n❌ Fatal error:", error)
    process.exit(1)
  })
}

export { captureNotifications, saveFixture }
