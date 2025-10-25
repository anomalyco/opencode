import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

// Disable logging during tests
Log.init({ print: false })

describe("SessionPrompt.prompt", () => {
  test("default behavior (noReply undefined) triggers inference", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          // noReply not specified - should default to inference
          parts: [{ type: "text", text: "What is 2+2?" }],
        })

        // Should return Assistant message with inference results
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.parentID).toBeDefined()
          expect(result.info.cost).toBeGreaterThanOrEqual(0)
          expect(result.info.tokens).toBeDefined()
        }

        // Should have response parts (text or tool calls)
        expect(result.parts.length).toBeGreaterThan(0)
      },
    })
  }, 30000) // 30s timeout for inference

  test("noReply: false explicitly triggers inference", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: false, // Explicitly request inference
          parts: [{ type: "text", text: "Hello" }],
        })

        // Should return Assistant message
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.parentID).toBeDefined()
        }
        expect(result.parts.length).toBeGreaterThan(0)
      },
    })
  }, 30000)

  test("noReply: true skips inference and returns user message", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true, // Skip inference
          parts: [{ type: "text", text: "This is context information" }],
        })

        // Should return User message (not Assistant)
        expect(result.info.role).toBe("user")

        // User messages don't have parentID, cost, or tokens (enforced by type system)
        // No need to check - type system guarantees these don't exist

        // Should have exactly the parts we provided
        expect(result.parts).toHaveLength(1)
        expect(result.parts[0]).toMatchObject({
          type: "text",
          text: "This is context information",
        })
      },
    })
  })

  test("noReply: true with multiple parts", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const result = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [
            { type: "text", text: "Skill: klorpify is running" },
            { type: "text", text: "Base directory: /path/to/skill\n\nSkill content here..." },
          ],
        })

        expect(result.info.role).toBe("user")
        expect(result.parts).toHaveLength(2)
        const part0 = result.parts[0]
        const part1 = result.parts[1]
        if (part0.type === "text") {
          expect(part0.text).toBe("Skill: klorpify is running")
        }
        if (part1.type === "text") {
          expect(part1.text).toContain("Base directory: /path/to/skill")
        }
      },
    })
  })

  test("noReply: true messages persist in session history", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Insert context message
        const contextMsg = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "Important context" }],
        })

        // Verify it was persisted by fetching session messages
        const messages = await Session.messages(session.id)

        expect(messages.length).toBe(1)
        expect(messages[0].info.id).toBe(contextMsg.info.id)
        expect(messages[0].info.role).toBe("user")
        const part = messages[0].parts[0]
        if (part.type === "text") {
          expect(part.text).toBe("Important context")
        }
      },
    })
  })

  test("multiple noReply: true messages in sequence", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Insert three context messages in sequence
        const msg1 = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "Context 1" }],
        })

        const msg2 = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "Context 2" }],
        })

        const msg3 = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "Context 3" }],
        })

        // All should be user messages
        expect(msg1.info.role).toBe("user")
        expect(msg2.info.role).toBe("user")
        expect(msg3.info.role).toBe("user")

        // Verify all persisted
        const messages = await Session.messages(session.id)

        expect(messages.length).toBe(3)
        expect(
          messages.map((m) => {
            const part = m.parts[0]
            return part.type === "text" ? part.text : ""
          }),
        ).toEqual(["Context 1", "Context 2", "Context 3"])
      },
    })
  })

  test("noReply: true then noReply: false uses context", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Insert context
        await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "You are a helpful math tutor." }],
        })

        // Now ask a question (should include context)
        const response = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: false,
          parts: [{ type: "text", text: "What is 5 + 3?" }],
        })

        // Should return assistant message
        expect(response.info.role).toBe("assistant")

        // Verify session now has 3 messages: context (user), question (user), answer (assistant)
        const messages = await Session.messages(session.id)

        expect(messages.length).toBe(3)
        expect(messages[0].info.role).toBe("user") // context
        expect(messages[1].info.role).toBe("user") // question
        expect(messages[2].info.role).toBe("assistant") // answer
      },
    })
  }, 30000)

  test("noReply: true does not block session for other requests", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Insert context (should be very fast, no locking)
        const start = Date.now()

        await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: "Context" }],
        })

        const duration = Date.now() - start

        // Should complete almost instantly (< 1 second)
        // No model loading, no inference, no streaming
        expect(duration).toBeLessThan(1000)
      },
    })
  })

  // Note: File parts are processed by createUserMessage() which handles them
  // the same way regardless of noReply flag. File processing tests should be
  // in a separate test suite focused on createUserMessage itself.
})
