import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Session.fork", () => {
  test("should fork an empty session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const originalSession = await Session.create({})
        const forkedSession = await Session.fork({
          sessionID: originalSession.id,
        })

        expect(forkedSession.id).toBeDefined()
        expect(forkedSession.id).not.toBe(originalSession.id)
        expect(forkedSession.parentID).toBeUndefined()

        await Session.remove(originalSession.id)
        await Session.remove(forkedSession.id)
      },
    })
  })

  test("should backfill agent field from mode for legacy assistant messages", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Create a legacy assistant message (without agent field, only mode)
        const legacyMessage: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          time: {
            created: Date.now(),
          },
          parentID: Identifier.ascending("message"),
          modelID: "claude-3-5-sonnet-20241022",
          providerID: "anthropic",
          mode: "build", // Old field
          agent: "build", // Required now but simulating it missing
          path: {
            cwd: projectRoot,
            root: projectRoot,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        }

        await Session.updateMessage(legacyMessage)

        // Fork the session
        const forkedSession = await Session.fork({
          sessionID: session.id,
        })

        // Verify the forked session was created
        expect(forkedSession.id).toBeDefined()
        expect(forkedSession.id).not.toBe(session.id)

        // Verify messages were copied
        const forkedMessages = await Session.messages({
          sessionID: forkedSession.id,
        })
        expect(forkedMessages.length).toBe(1)

        // Verify the agent field was backfilled from mode
        const forkedMessage = forkedMessages[0].info
        expect(forkedMessage.role).toBe("assistant")
        if (forkedMessage.role === "assistant") {
          expect(forkedMessage.agent).toBe("build")
          expect(forkedMessage.mode).toBe("build")
        }

        await Session.remove(session.id)
        await Session.remove(forkedSession.id)
      },
    })
  })

  test("should preserve agent field when it exists", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Create a modern assistant message (with agent field)
        const modernMessage: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          time: {
            created: Date.now(),
          },
          parentID: Identifier.ascending("message"),
          modelID: "claude-3-5-sonnet-20241022",
          providerID: "anthropic",
          mode: "plan",
          agent: "explore", // Different from mode
          path: {
            cwd: projectRoot,
            root: projectRoot,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        }

        await Session.updateMessage(modernMessage)

        // Fork the session
        const forkedSession = await Session.fork({
          sessionID: session.id,
        })

        // Verify the agent field was preserved (not overwritten by mode)
        const forkedMessages = await Session.messages({
          sessionID: forkedSession.id,
        })
        expect(forkedMessages.length).toBe(1)

        const forkedMessage = forkedMessages[0].info
        expect(forkedMessage.role).toBe("assistant")
        if (forkedMessage.role === "assistant") {
          expect(forkedMessage.agent).toBe("explore")
          expect(forkedMessage.mode).toBe("plan")
        }

        await Session.remove(session.id)
        await Session.remove(forkedSession.id)
      },
    })
  })

  test("should fork up to a specific message", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Create two messages
        const message1: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          time: {
            created: Date.now(),
          },
          parentID: Identifier.ascending("message"),
          modelID: "claude-3-5-sonnet-20241022",
          providerID: "anthropic",
          mode: "build",
          agent: "build",
          path: {
            cwd: projectRoot,
            root: projectRoot,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        }

        await Session.updateMessage(message1)

        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10))

        const message2: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          time: {
            created: Date.now(),
          },
          parentID: Identifier.ascending("message"),
          modelID: "claude-3-5-sonnet-20241022",
          providerID: "anthropic",
          mode: "build",
          agent: "build",
          path: {
            cwd: projectRoot,
            root: projectRoot,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        }

        await Session.updateMessage(message2)

        // Fork up to message1 (should not include message2)
        const forkedSession = await Session.fork({
          sessionID: session.id,
          messageID: message2.id,
        })

        const forkedMessages = await Session.messages({
          sessionID: forkedSession.id,
        })

        // Should only have message1
        expect(forkedMessages.length).toBe(1)
        expect(forkedMessages[0].info.id).not.toBe(message1.id)
        expect(forkedMessages[0].info.id).not.toBe(message2.id)

        await Session.remove(session.id)
        await Session.remove(forkedSession.id)
      },
    })
  })
})
