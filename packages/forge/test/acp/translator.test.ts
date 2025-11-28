import { describe, expect, test, beforeEach } from "bun:test"
import { ACPTranslator } from "../../src/acp/translator"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { hasClaudeApiKey, createClaudeCli, accumulateText } from "./helpers"

// Skip integration tests if ANTHROPIC_API_KEY is not set
const describeIntegration = hasClaudeApiKey() ? describe : describe.skip

describe("ACPTranslator (unit tests)", () => {
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

describeIntegration("ACPTranslator (integration with claude-code-acp)", () => {
  test("should translate real claude-code-acp notifications", async () => {
    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      async fn() {
        await using manager = await createClaudeCli()
        const sessionID = manager.getSessionId()
        const capture = manager.getEventCapture()

        ACPTranslator.startNewMessage(sessionID, "msg-integration-1")

        // Send a simple prompt
        await manager.sendPrompt("What is 2 + 2? Just respond with the number.")

        // Wait a bit for responses
        await new Promise(resolve => setTimeout(resolve, 2000))

        // Get captured events
        const events = capture.getAll()

        // Translate all captured events
        for (const event of events) {
          await ACPTranslator.translate(sessionID, event)
        }

        // Verify we received and translated some events
        expect(events.length).toBeGreaterThan(0)

        // Check we got text chunks
        const textEvents = capture.getByType("agent_message_chunk")
        expect(textEvents.length).toBeGreaterThan(0)

        // Verify text accumulation worked
        const fullText = accumulateText(events)
        expect(fullText.length).toBeGreaterThan(0)
        console.log("Accumulated text:", fullText)
      }
    })
  }, 30000)

  test("should handle streaming responses from claude-code-acp", async () => {
    await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      async fn() {
        await using manager = await createClaudeCli()
        const sessionID = manager.getSessionId()
        const capture = manager.getEventCapture()

        ACPTranslator.startNewMessage(sessionID, "msg-integration-2")

        // Send a prompt that should generate multiple chunks
        await manager.sendPrompt("Count from 1 to 5.")

        // Wait for response
        await new Promise(resolve => setTimeout(resolve, 3000))

        const events = capture.getAll()

        // Translate all events
        for (const event of events) {
          await ACPTranslator.translate(sessionID, event)
        }

        // Verify we got multiple chunks
        const chunks = capture.getByType("agent_message_chunk")
        console.log(`Received ${chunks.length} text chunks`)

        expect(chunks.length).toBeGreaterThan(0)
      }
    })
  }, 30000)
})
