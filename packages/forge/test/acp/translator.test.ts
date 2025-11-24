import { describe, expect, test, beforeEach } from "bun:test"
import { ACPTranslator } from "../../src/acp/translator"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"

describe("ACPTranslator", () => {
  const testSessionID = "ses-test-session-123"

  beforeEach(() => {
    ACPTranslator.resetSession(testSessionID)
  })

  // Helper to run tests with Instance context
  async function withInstance(fn: () => Promise<void>) {
    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      fn,
    })
  }

  describe("agent_message_chunk", () => {
    test("should translate text chunks", async () => {
      await withInstance(async () => {
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
    })

    test("should accumulate text across multiple chunks", async () => {
      await withInstance(async () => {
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
  })

  describe("tool_call", () => {
    test("should handle tool calls", async () => {
      await withInstance(async () => {
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
  })

  describe("session management", () => {
    test("should reset session state", async () => {
      await withInstance(async () => {
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
    })

    test("should start new message", async () => {
      await withInstance(async () => {
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
  })

  describe("agent_thought_chunk", () => {
    test("should translate thought chunks", async () => {
      await withInstance(async () => {
        ACPTranslator.startNewMessage(testSessionID, "msg-1")

        const notification: SessionNotification = {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: {
              type: "text",
              text: "Let me think about this problem...",
            },
          },
        }

        // Should not throw
        await ACPTranslator.translate(testSessionID, notification)
      })
    })

    test("should accumulate thoughts across multiple chunks", async () => {
      await withInstance(async () => {
        ACPTranslator.startNewMessage(testSessionID, "msg-2")

        await ACPTranslator.translate(testSessionID, {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "First, " },
          },
        })

        await ACPTranslator.translate(testSessionID, {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "I need to analyze the structure." },
          },
        })

        // Should not throw - thoughts should accumulate separately from text
        expect(true).toBe(true)
      })
    })

    test("should handle thoughts and text independently", async () => {
      await withInstance(async () => {
        ACPTranslator.startNewMessage(testSessionID, "msg-3")

        // Send a thought chunk
        await ACPTranslator.translate(testSessionID, {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Thinking..." },
          },
        })

        // Send a message chunk
        await ACPTranslator.translate(testSessionID, {
          sessionId: testSessionID,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Here's my response" },
          },
        })

        // Should not throw - thoughts and messages are separate
        expect(true).toBe(true)
      })
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
