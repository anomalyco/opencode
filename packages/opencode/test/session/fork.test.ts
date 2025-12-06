import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Session.fork", () => {
  test("should fork entire session without message ID", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const originalSession = await Session.create({
          title: "Original Session",
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: originalSession.id,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "opencode", modelID: "claude-3-5-sonnet-20241022" },
        })

        const forkedSession = await Session.fork({
          sessionID: originalSession.id,
        })

        expect(forkedSession).toBeDefined()
        expect(forkedSession.id).not.toBe(originalSession.id)
        expect(forkedSession.directory).toBe(originalSession.directory)
        expect(forkedSession.projectID).toBe(originalSession.projectID)

        const originalMessages = await Session.messages({ sessionID: originalSession.id })
        const forkedMessages = await Session.messages({ sessionID: forkedSession.id })

        expect(forkedMessages.length).toBe(originalMessages.length)

        await Session.remove(originalSession.id)
        await Session.remove(forkedSession.id)
      },
    })
  })

  test("should fork session up to specific message", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const originalSession = await Session.create({
          title: "Session with Multiple Messages",
        })

        const msg1 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: originalSession.id,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "opencode", modelID: "claude-3-5-sonnet-20241022" },
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: originalSession.id,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "opencode", modelID: "claude-3-5-sonnet-20241022" },
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: originalSession.id,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "opencode", modelID: "claude-3-5-sonnet-20241022" },
        })

        const forkedSession = await Session.fork({
          sessionID: originalSession.id,
          messageID: msg1.id,
        })

        const originalMessages = await Session.messages({ sessionID: originalSession.id })
        const forkedMessages = await Session.messages({ sessionID: forkedSession.id })

        expect(originalMessages.length).toBe(3)
        expect(forkedMessages.length).toBe(1)

        await Session.remove(originalSession.id)
        await Session.remove(forkedSession.id)
      },
    })
  })

  test("should create independent forked session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const originalSession = await Session.create({
          title: "Original Independent",
        })

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: originalSession.id,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "opencode", modelID: "claude-3-5-sonnet-20241022" },
        })

        const forkedSession = await Session.fork({
          sessionID: originalSession.id,
        })

        const newMsgInFork = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: forkedSession.id,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "opencode", modelID: "claude-3-5-sonnet-20241022" },
        })

        const originalMessages = await Session.messages({ sessionID: originalSession.id })
        const forkedMessages = await Session.messages({ sessionID: forkedSession.id })

        expect(originalMessages.length).toBe(1)
        expect(forkedMessages.length).toBe(2)

        const msgExistsInFork = forkedMessages.some((m) => m.info.id === newMsgInFork.id)
        const msgExistsInOriginal = originalMessages.some((m) => m.info.id === newMsgInFork.id)

        expect(msgExistsInFork).toBe(true)
        expect(msgExistsInOriginal).toBe(false)

        await Session.remove(originalSession.id)
        await Session.remove(forkedSession.id)
      },
    })
  })

  test("should copy message parts when forking", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const originalSession = await Session.create({
          title: "Session with Parts",
        })

        const msg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: originalSession.id,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "opencode", modelID: "claude-3-5-sonnet-20241022" },
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: msg.id,
          sessionID: originalSession.id,
          type: "text",
          text: "Test message content",
        })

        const forkedSession = await Session.fork({
          sessionID: originalSession.id,
        })

        const forkedMessages = await Session.messages({ sessionID: forkedSession.id })

        expect(forkedMessages.length).toBe(1)
        expect(forkedMessages[0].parts.length).toBe(1)
        expect(forkedMessages[0].parts[0].type).toBe("text")

        if (forkedMessages[0].parts[0].type === "text") {
          expect(forkedMessages[0].parts[0].text).toBe("Test message content")
        }

        await Session.remove(originalSession.id)
        await Session.remove(forkedSession.id)
      },
    })
  })

  test("should handle empty session fork", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const originalSession = await Session.create({
          title: "Empty Session",
        })

        const forkedSession = await Session.fork({
          sessionID: originalSession.id,
        })

        expect(forkedSession).toBeDefined()
        expect(forkedSession.id).not.toBe(originalSession.id)

        const forkedMessages = await Session.messages({ sessionID: forkedSession.id })
        expect(forkedMessages.length).toBe(0)

        await Session.remove(originalSession.id)
        await Session.remove(forkedSession.id)
      },
    })
  })

  test("should throw error for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const nonExistentSessionID = "session_nonexistent123"

        try {
          await Session.fork({
            sessionID: nonExistentSessionID,
          })
          expect(true).toBe(false)
        } catch (error) {
          expect(error).toBeDefined()
        }
      },
    })
  })

  test("forked session should have different ID but same project", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const originalSession = await Session.create({
          title: "Project Test",
        })

        const forkedSession = await Session.fork({
          sessionID: originalSession.id,
        })

        expect(forkedSession.id).not.toBe(originalSession.id)
        expect(forkedSession.projectID).toBe(originalSession.projectID)
        expect(forkedSession.directory).toBe(originalSession.directory)
        expect(forkedSession.version).toBe(originalSession.version)

        await Session.remove(originalSession.id)
        await Session.remove(forkedSession.id)
      },
    })
  })
})
