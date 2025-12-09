/**
 * Integration Test: Debug Tool Calls
 *
 * Captures actual tool_call notifications from Claude Code to debug the UI issue.
 *
 * Run with: FORGE_RUN_INTEGRATION=1 ANTHROPIC_API_KEY=xxx bun test test/acp/integration/tool-call-debug.test.ts
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
const testIntegration = runIntegration ? test : test.skip

describe("Tool Call Debug", () => {
  testIntegration(
    "should capture tool_call notification structure",
    async () => {
      const toolCallNotifications: SessionNotification[] = []
      const toolUpdateNotifications: SessionNotification[] = []

      const client = await ACPClient.create({
        command: "npx",
        args: ["@zed-industries/claude-code-acp"],
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      onSessionUpdate: (update: SessionNotification) => {
        if (update.update.sessionUpdate === "tool_call") {
          toolCallNotifications.push(update)
          console.log("\n=== TOOL_CALL NOTIFICATION ===")
          console.log(JSON.stringify(update, null, 2))
        }
        if (update.update.sessionUpdate === "tool_call_update") {
          toolUpdateNotifications.push(update)
          console.log("\n=== TOOL_CALL_UPDATE NOTIFICATION ===")
          console.log(JSON.stringify(update, null, 2))
        }
      },
    })

    try {
      await client.initialize()
      const sessionResponse = await client.createSession()

      // Ask Claude Code to read a file - this should trigger a Read tool call
      const prompt = "Read the file at /Users/patrickerichsen/Git/forge/forge/README.md"
      await client.sendPrompt(sessionResponse.sessionId, prompt)

      // Wait a bit for all notifications
      await new Promise((resolve) => setTimeout(resolve, 2000))

      console.log(`\n=== SUMMARY ===`)
      console.log(`Total tool_call notifications: ${toolCallNotifications.length}`)
      console.log(`Total tool_call_update notifications: ${toolUpdateNotifications.length}`)

      if (toolCallNotifications.length > 0) {
        const firstCall = toolCallNotifications[0]
        if (firstCall.update.sessionUpdate === "tool_call") {
          console.log(`\n=== FIRST TOOL_CALL DETAILS ===`)
          console.log(`kind: ${firstCall.update.kind}`)
          console.log(`title: ${firstCall.update.title}`)
          console.log(`status: ${firstCall.update.status}`)
          console.log(`rawInput:`, firstCall.update.rawInput)
          console.log(`rawOutput:`, firstCall.update.rawOutput)
        }
      }

      expect(toolCallNotifications.length).toBeGreaterThan(0)
    } finally {
      await client.dispose()
    }
  },
    { timeout: 60000 },
  )
})
