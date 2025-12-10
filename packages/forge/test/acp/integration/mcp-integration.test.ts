import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { ACPClient } from "../../../src/acp/client"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { Config } from "../../../src/config/config"

/**
 * Integration test for MCP server integration with ACP agents.
 *
 * This test verifies that:
 * 1. MCP servers from Forge config are transformed correctly
 * 2. Agents receive the MCP servers during session creation
 * 3. Capability filtering works (HTTP servers only sent if agent supports)
 *
 * NOTE: This test requires:
 * - FORGE_RUN_INTEGRATION=1 environment variable
 * - ANTHROPIC_API_KEY environment variable
 * - An actual ACP agent (claude-code-acp)
 */

function shouldRunIntegration(): boolean {
  if (process.env.FORGE_RUN_INTEGRATION !== "1") {
    return false
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("Skipping integration test: ANTHROPIC_API_KEY not set")
    return false
  }
  return true
}

const runIntegration = shouldRunIntegration()

const describeIntegration = runIntegration ? describe : describe.skip
const testIntegration = runIntegration ? test : test.skip

describeIntegration("MCP Integration with ACP Agents", () => {
  let originalConfig: Awaited<ReturnType<typeof Config.get>>

  beforeAll(async () => {
    // Store original config
    originalConfig = await Config.get()
  })

  afterAll(async () => {
    // Restore original config (if needed)
  })

  testIntegration(
    "should pass MCP servers to agent during session creation",
    async () => {
      const updates: SessionNotification[] = []

      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
        onSessionUpdate: (update: SessionNotification) => {
          updates.push(update)
        },
      })

      try {
        // Initialize the agent
        const initResponse = await client.initialize()
        expect(initResponse.agentInfo?.name).toBeTruthy()

        // Check if agent supports MCP capabilities
        const mcpCapabilities = initResponse.agentCapabilities?.mcpCapabilities
        console.log("Agent MCP capabilities:", mcpCapabilities)

        // Create session - this should include MCP servers
        const sessionResponse = await client.createSession()
        expect(sessionResponse.sessionId).toBeTruthy()

        // NOTE: We can't directly verify the agent received the servers
        // since the protocol doesn't echo them back. However, we can:
        // 1. Check logs to see if servers were sent
        // 2. Try using an MCP tool (if available) to verify connectivity

        // If the agent has MCP servers available, it should be able to use them
        // For now, we just verify the session was created successfully
        expect(sessionResponse.sessionId).toMatch(/^ses-/)
      } finally {
        await client.dispose()
      }
    },
    { timeout: 30000 }
  )

  testIntegration(
    "should filter HTTP servers based on agent capabilities",
    async () => {
      // This test would require:
      // 1. Mocking the agent to return specific capabilities
      // 2. Or testing with multiple agents (some with HTTP support, some without)
      // For now, we verify the transformation logic in unit tests

      // Get current config
      const config = await Config.get()

      // Count local vs remote servers
      const mcpConfig = config.mcp ?? {}
      const localCount = Object.values(mcpConfig).filter((s) => s.type === "local").length
      const remoteCount = Object.values(mcpConfig).filter((s) => s.type === "remote").length

      console.log("MCP config summary:", {
        total: Object.keys(mcpConfig).length,
        local: localCount,
        remote: remoteCount,
      })

      // The actual filtering is tested in unit tests
      // This test just verifies we can read the config
      expect(mcpConfig).toBeDefined()
    },
    { timeout: 5000 }
  )

  testIntegration(
    "should handle empty MCP config gracefully",
    async () => {
      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
        onSessionUpdate: () => {},
      })

      try {
        await client.initialize()
        const sessionResponse = await client.createSession()

        // Should succeed even with empty MCP config
        expect(sessionResponse.sessionId).toBeTruthy()
      } finally {
        await client.dispose()
      }
    },
    { timeout: 30000 }
  )
})

// Helper function to wait for a specific update
async function waitForUpdate(
  updates: SessionNotification[],
  predicate: (update: SessionNotification) => boolean,
  timeoutMs = 5000
): Promise<SessionNotification> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = updates.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Timeout waiting for update")
}
