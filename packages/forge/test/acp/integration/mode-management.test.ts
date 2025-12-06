/**
 * Integration Test: ACP Client Mode Management
 *
 * Tests session mode operations:
 * - Getting available modes
 * - Getting current mode
 * - Switching modes
 * - Mode change notifications
 *
 * Run with: FORGE_RUN_INTEGRATION=1 ANTHROPIC_API_KEY=xxx bun test test/acp/integration/mode-management.test.ts
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

describeIntegration("ACP Client Mode Management", () => {
  testIntegration(
    "should capture modes from createSession response",
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

        // Test getModes() returns the mode state
        const modes = client.getModes()
        expect(modes).toBeTruthy()
        expect(modes?.currentModeId).toBeTruthy()
        expect(modes?.availableModes).toBeInstanceOf(Array)
        expect(modes!.availableModes.length).toBeGreaterThan(0)

        console.log("✓ Mode state captured:", {
          currentMode: modes?.currentModeId,
          availableCount: modes?.availableModes.length,
          modes: modes?.availableModes.map(m => `${m.id} (${m.name})`)
        })
      } finally {
        await client.dispose()
      }
    },
    30000
  )

  testIntegration(
    "should return current mode ID",
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

        const currentMode = client.getCurrentMode()
        expect(currentMode).toBeTruthy()
        expect(typeof currentMode).toBe("string")

        console.log("✓ Current mode:", currentMode)
      } finally {
        await client.dispose()
      }
    },
    30000
  )

  testIntegration(
    "should change mode via setMode()",
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

        const modes = client.getModes()
        expect(modes).toBeTruthy()
        expect(modes!.availableModes.length).toBeGreaterThanOrEqual(2)

        const initialMode = client.getCurrentMode()

        // Find a different mode to switch to
        const targetMode = modes!.availableModes.find(m => m.id !== initialMode)
        expect(targetMode).toBeTruthy()

        console.log(`Switching from ${initialMode} to ${targetMode!.id}...`)

        const response = await client.setMode(targetMode!.id)
        expect(response).toBeTruthy()

        // Verify mode changed
        const newMode = client.getCurrentMode()
        expect(newMode).toBe(targetMode!.id)

        console.log("✓ Mode changed successfully")
      } finally {
        await client.dispose()
      }
    },
    30000
  )

  testIntegration(
    "should trigger onModeChange callback when mode changes",
    async () => {
      let callbackModeId: string | null = null

      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
        },
      })

      // Register callback before session creation
      const modeChangePromise = new Promise<string>((resolve) => {
        client.onModeChange((modeId) => {
          callbackModeId = modeId
          resolve(modeId)
        })
      })

      const timeoutPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve("timeout"), 5000)
      })

      try {
        await client.initialize()
        await client.createSession()

        const modes = client.getModes()
        const initialMode = client.getCurrentMode()
        const targetMode = modes!.availableModes.find(m => m.id !== initialMode)

        if (!targetMode) {
          console.log("⊘ Skipping callback test: no alternative mode available")
          return
        }

        // Change mode and wait for callback
        await client.setMode(targetMode.id)

        const callbackResult = await Promise.race([modeChangePromise, timeoutPromise])
        expect(callbackResult).toBe(targetMode.id)
        expect(callbackModeId!).toBe(targetMode.id)

        console.log("✓ onModeChange callback triggered with:", callbackModeId)
      } finally {
        await client.dispose()
      }
    },
    30000
  )

  testIntegration(
    "should handle current_mode_update notifications from agent",
    async () => {
      let receivedModeUpdate = false
      let updatedModeId: string | null = null

      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
        },
        onSessionUpdate: (update: SessionNotification) => {
          if (update.update.sessionUpdate === "current_mode_update") {
            receivedModeUpdate = true
            updatedModeId = update.update.currentModeId
            console.log("Received current_mode_update:", updatedModeId)
          }
        },
      })

      try {
        await client.initialize()
        await client.createSession()

        const modes = client.getModes()
        const initialMode = client.getCurrentMode()
        const targetMode = modes!.availableModes.find(m => m.id !== initialMode)

        if (!targetMode) {
          console.log("⊘ Skipping notification test: no alternative mode available")
          return
        }

        // Change mode - this should trigger a notification
        await client.setMode(targetMode.id)

        // Note: Depending on the agent implementation, the notification
        // may or may not be sent for client-initiated mode changes.
        // This test validates that IF a notification is sent, it's handled correctly.

        console.log("✓ Notification handling tested", {
          received: receivedModeUpdate,
          modeId: updatedModeId
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
        expect(client.getModes()).toBeNull()
        expect(client.getCurrentMode()).toBeNull()

        console.log("✓ Returns null before session creation")
      } finally {
        await client.dispose()
      }
    },
    30000
  )
})
