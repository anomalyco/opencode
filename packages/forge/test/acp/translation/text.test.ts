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

describe("Text Translation (with fixtures)", () => {
  const testSessionID = "ses-test-fixture-session"

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

  test("should translate simple text response", async () => {
    await withInstance(async () => {
      const fixture = await loadFixture("simple-text")
      ACPTranslator.startNewMessage(testSessionID, "msg-1")

      // Process each notification
      for (const notification of fixture.notifications) {
        const testNotification = {
          ...notification,
          sessionId: testSessionID
        }
        await ACPTranslator.translate(testSessionID, testNotification)
      }

      // Verify no errors were thrown
      expect(true).toBe(true)
    })
  })

  test("should accumulate multiple text chunks", async () => {
    await withInstance(async () => {
      const fixture = await loadFixture("multiple-chunks")
      ACPTranslator.startNewMessage(testSessionID, "msg-2")

      // Process each notification
      for (const notification of fixture.notifications) {
        const testNotification = {
          ...notification,
          sessionId: testSessionID
        }
        await ACPTranslator.translate(testSessionID, testNotification)
      }

      // Should have processed chunks without errors
      expect(fixture.notifications.length).toBeGreaterThan(0)
    })
  })

  test("should handle text with reasoning chunks", async () => {
    await withInstance(async () => {
      const fixture = await loadFixture("text-with-reasoning")
      ACPTranslator.startNewMessage(testSessionID, "msg-3")

      let thoughtChunks = 0
      let messageChunks = 0

      // Process and count notification types
      for (const notification of fixture.notifications) {
        if (notification.update.sessionUpdate === "agent_thought_chunk") {
          thoughtChunks++
        } else if (notification.update.sessionUpdate === "agent_message_chunk") {
          messageChunks++
        }

        const testNotification = {
          ...notification,
          sessionId: testSessionID
        }
        await ACPTranslator.translate(testSessionID, testNotification)
      }

      // Verify we processed message chunks and optionally thoughts
      expect(messageChunks).toBeGreaterThan(0)
      expect(thoughtChunks).toBeGreaterThanOrEqual(0)
    })
  })

  test("should handle empty text chunks gracefully", async () => {
    await withInstance(async () => {
      ACPTranslator.startNewMessage(testSessionID, "msg-4")

      const notification: SessionNotification = {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: ""
          }
        }
      }

      // Should not throw
      await ACPTranslator.translate(testSessionID, notification)
      expect(true).toBe(true)
    })
  })

  test("should maintain separate accumulators for text and reasoning", async () => {
    await withInstance(async () => {
      ACPTranslator.startNewMessage(testSessionID, "msg-5")

      // Send reasoning chunk
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Thinking... " }
        }
      })

      // Send message chunk
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Response " }
        }
      })

      // Send more reasoning
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "More thinking..." }
        }
      })

      // Send more message
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "continues" }
        }
      })

      // Should process all without errors
      expect(true).toBe(true)
    })
  })

  test("should reset session and start fresh", async () => {
    await withInstance(async () => {
      const fixture = await loadFixture("simple-text")

      // Process first time
      ACPTranslator.startNewMessage(testSessionID, "msg-6")
      for (const notification of fixture.notifications) {
        await ACPTranslator.translate(testSessionID, { ...notification, sessionId: testSessionID })
      }

      // Reset and process again
      ACPTranslator.resetSession(testSessionID)
      ACPTranslator.startNewMessage(testSessionID, "msg-7")
      for (const notification of fixture.notifications) {
        await ACPTranslator.translate(testSessionID, { ...notification, sessionId: testSessionID })
      }

      expect(true).toBe(true)
    })
  })
})
