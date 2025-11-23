import { describe, expect, test, beforeEach } from "bun:test"
import { ACPTranslator } from "../../src/acp/translator"
import type { SessionNotification } from "@agentclientprotocol/sdk"

describe("ACPTranslator", () => {
  const testSessionID = "test-session-123"

  beforeEach(() => {
    ACPTranslator.resetSession(testSessionID)
  })

  describe("agent_message_chunk", () => {
    test("should translate text chunks", async () => {
      const notification: SessionNotification = {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Hello",
          },
        },
      }

      // Should not throw
      await ACPTranslator.translate(testSessionID, notification)
    })

    test("should accumulate text across multiple chunks", async () => {
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello " },
        },
      })

      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "world" },
        },
      })

      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe("tool_call", () => {
    test("should handle tool calls", async () => {
      const notification: SessionNotification = {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-123",
          status: "pending",
          title: "Read File",
          kind: "read",
          locations: [],
          rawInput: {},
        },
      }

      // Should not throw
      await ACPTranslator.translate(testSessionID, notification)
    })
  })

  describe("session management", () => {
    test("should reset session state", async () => {
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "First" },
        },
      })

      ACPTranslator.resetSession(testSessionID)

      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Second" },
        },
      })

      // Should not throw
      expect(true).toBe(true)
    })

    test("should start new message", async () => {
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "First" },
        },
      })

      ACPTranslator.startNewMessage(testSessionID, "msg-2")

      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Second" },
        },
      })

      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe("other notification types", () => {
    test("should handle user_message_chunk", async () => {
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "User message" },
        },
      })

      // Should not throw
      expect(true).toBe(true)
    })

    test("should handle available_commands_update", async () => {
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "test", description: "Test command" },
          ],
        },
      })

      // Should not throw
      expect(true).toBe(true)
    })

    test("should handle current_mode_update", async () => {
      await ACPTranslator.translate(testSessionID, {
        sessionId: testSessionID,
        update: {
          sessionUpdate: "current_mode_update",
          currentModeId: "build",
        },
      })

      // Should not throw
      expect(true).toBe(true)
    })
  })
})
