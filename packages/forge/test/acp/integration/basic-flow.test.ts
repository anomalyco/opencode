/**
 * Integration Test: Basic ACP Client Flow
 *
 * Tests the fundamental ACP client operations:
 * - Connection and initialization
 * - Session creation
 * - Sending prompts
 * - Receiving responses
 *
 * Run with: FORGE_RUN_INTEGRATION=1 ANTHROPIC_API_KEY=xxx bun test test/acp/integration/basic-flow.test.ts
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

describeIntegration("ACP Client Basic Flow", () => {
  testIntegration("should connect, initialize, create session, and send prompt", async () => {

    const messages: string[] = []

    const client = await ACPClient.create({
      command: "npx",
      args: ["@zed-industries/claude-code-acp"],
      cwd: process.cwd(),
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
      onSessionUpdate: (update: SessionNotification) => {
        if (update.update.sessionUpdate === "agent_message_chunk") {
          if (update.update.content.type === "text") {
            messages.push(update.update.content.text)
          }
        }
      },
    })

    try {
      // Initialize
      const initResponse = await client.initialize()
      expect(initResponse).toBeTruthy()
      expect(initResponse.agentInfo?.name).toBeTruthy()
      expect(initResponse.protocolVersion).toBeTruthy()

      // Create session
      const sessionResponse = await client.createSession()
      expect(sessionResponse).toBeTruthy()
      expect(sessionResponse.sessionId).toBeTruthy()

      // Send prompt
      const prompt = "What is 2 + 2? Please give a brief answer."
      const promptResponse = await client.sendPrompt(sessionResponse.sessionId, prompt)

      expect(promptResponse).toBeTruthy()
      expect(promptResponse.stopReason).toBeTruthy()
      expect(messages.length).toBeGreaterThan(0)

      console.log("✓ Basic flow completed successfully")
    } finally {
      await client.dispose()
    }
  })

  testIntegration("should handle authentication when required", async () => {

    const client = await ACPClient.create({
      command: "npx",
      args: ["@zed-industries/claude-code-acp"],
      cwd: process.cwd(),
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    })

    try {
      await client.initialize()

      const authMethods = client.getAuthMethods()
      expect(Array.isArray(authMethods)).toBe(true)

      console.log(`✓ Found ${authMethods.length} auth methods`)
    } finally {
      await client.dispose()
    }
  })

  testIntegration("should maintain connection state", async () => {

    const client = await ACPClient.create({
      command: "npx",
      args: ["@zed-industries/claude-code-acp"],
      cwd: process.cwd(),
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    })

    try {
      expect(client.isConnected()).toBe(false)

      await client.initialize()
      expect(client.isConnected()).toBe(true)

      await client.createSession()
      expect(client.isConnected()).toBe(true)

      console.log("✓ Connection state maintained correctly")
    } finally {
      await client.dispose()
    }
  })
})
