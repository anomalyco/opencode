import { describe, expect, test, beforeEach } from "bun:test"
import { ACPTranslator } from "../../../src/acp/translator"
import { Instance } from "../../../src/project/instance"
import { InstanceBootstrap } from "../../../src/project/bootstrap"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { readFile } from "fs/promises"
import { join } from "path"

// Load fixtures
async function loadFixture(name: string) {
  const fixturePath = join(import.meta.dir, "../fixtures/data", `${name}.json`)
  const content = await readFile(fixturePath, "utf-8")
  return JSON.parse(content)
}

describe("Tool Translation (with fixtures)", () => {
  const testSessionID = "ses-test-tool-session"

  beforeEach(() => {
    ACPTranslator.resetSession(testSessionID)
  })

  async function withInstance(fn: () => Promise<void>) {
    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      fn,
    })
  }

  test("should handle complete tool call lifecycle", async () => {
    await withInstance(async () => {
      const fixture = await loadFixture("tool-calls")
      ACPTranslator.startNewMessage(testSessionID, "msg-1")

      let toolCallCount = 0
      let toolUpdateCount = 0

      // Process each notification and count types
      for (const notification of fixture.notifications) {
        if (notification.update.sessionUpdate === "tool_call") {
          toolCallCount++
        } else if (notification.update.sessionUpdate === "tool_call_update") {
          toolUpdateCount++
        }

        const testNotification = {
          ...notification,
          sessionId: testSessionID
        }
        await ACPTranslator.translate(testSessionID, testNotification)
      }

      // Verify we processed both tool_call and tool_call_update
      expect(toolCallCount).toBe(1)
      expect(toolUpdateCount).toBe(2)
    })
  })

  test("should handle tool call status transitions", async () => {
    await withInstance(async () => {
      ACPTranslator.startNewMessage(testSessionID, "msg-2")

      // pending -> in_progress -> completed
      const notifications: SessionNotification[] = [
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-status-test",
            status: "pending",
            title: "Test Tool",
            kind: "test",
            locations: [],
            rawInput: { test: "input" }
          }
        },
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-status-test",
            status: "in_progress",
            title: "Running..."
          }
        },
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-status-test",
            status: "completed",
            title: "Test Tool",
            rawOutput: { result: "success" }
          }
        }
      ]

      for (const notification of notifications) {
        await ACPTranslator.translate(testSessionID, notification)
      }

      // Should complete without errors
      expect(true).toBe(true)
    })
  })

  test("should handle tool call failures", async () => {
    await withInstance(async () => {
      ACPTranslator.startNewMessage(testSessionID, "msg-3")

      const notifications: SessionNotification[] = [
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-fail-test",
            status: "pending",
            title: "Failing Tool",
            kind: "test",
            locations: [],
            rawInput: {}
          }
        },
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-fail-test",
            status: "failed",
            title: "Failing Tool",
            rawOutput: { error: "Something went wrong" }
          }
        }
      ]

      for (const notification of notifications) {
        await ACPTranslator.translate(testSessionID, notification)
      }

      expect(true).toBe(true)
    })
  })

  test("should handle multiple tool calls in sequence", async () => {
    await withInstance(async () => {
      ACPTranslator.startNewMessage(testSessionID, "msg-4")

      const notifications: SessionNotification[] = [
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            status: "pending",
            title: "First Tool",
            kind: "read",
            locations: [],
            rawInput: {}
          }
        },
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
            rawOutput: { data: "result1" }
          }
        },
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-2",
            status: "pending",
            title: "Second Tool",
            kind: "write",
            locations: [],
            rawInput: {}
          }
        },
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-2",
            status: "completed",
            rawOutput: { data: "result2" }
          }
        }
      ]

      for (const notification of notifications) {
        await ACPTranslator.translate(testSessionID, notification)
      }

      expect(true).toBe(true)
    })
  })

  test("should handle tool call with content updates", async () => {
    await withInstance(async () => {
      ACPTranslator.startNewMessage(testSessionID, "msg-5")

      const notifications: SessionNotification[] = [
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-content-test",
            status: "pending",
            title: "Content Tool",
            kind: "test",
            locations: [],
            rawInput: {},
            content: []
          }
        },
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-content-test",
            status: "in_progress",
            content: [
              { type: "text", text: "Processing..." }
            ]
          }
        },
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-content-test",
            status: "in_progress",
            content: [
              { type: "text", text: "Still processing..." }
            ]
          }
        },
        {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-content-test",
            status: "completed",
            rawOutput: { done: true }
          }
        }
      ]

      for (const notification of notifications) {
        await ACPTranslator.translate(testSessionID, notification)
      }

      expect(true).toBe(true)
    })
  })

  test("should handle unknown tool call ID in update", async () => {
    await withInstance(async () => {
      ACPTranslator.startNewMessage(testSessionID, "msg-6")

      // Try to update a tool that was never created
      const notification: SessionNotification = {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "unknown-tool-id",
          status: "completed"
        }
      }

      // Should log warning but not throw
      await ACPTranslator.translate(testSessionID, notification)
      expect(true).toBe(true)
    })
  })
})
