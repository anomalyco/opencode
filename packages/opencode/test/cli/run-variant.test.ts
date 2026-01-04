import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("run --variant option", () => {
  test("variant is accepted in POST /session/:sessionID/message (prompt path)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const session = await Session.create({})
        const app = Server.App()

        // #when - send a prompt with variant and noReply to skip LLM call
        const response = await app.request(`/session/${session.id}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variant: "high",
            noReply: true,
            parts: [{ type: "text", text: "test message" }],
          }),
        })

        // #then - request should be accepted
        expect(response.status).toBe(200)

        // Read the streamed response to get the created message
        const responseBody = await response.text()
        const msg = JSON.parse(responseBody)
        
        // The response contains the created user message
        expect(msg.info).toBeDefined()
        expect(msg.info.role).toBe("user")
        expect(msg.info.variant).toBe("high")

        await Session.remove(session.id)
      },
    })
  })

  test("variant is accepted in CommandInput schema", async () => {
    // This test verifies that the CommandInput schema accepts the variant field
    // by directly testing the schema parsing
    const { SessionPrompt } = await import("../../src/session/prompt")

    // #when - parse input with variant
    const result = SessionPrompt.CommandInput.safeParse({
      sessionID: "ses_test123",
      command: "init",
      arguments: "",
      variant: "max",
    })

    // #then - schema should accept the variant field
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variant).toBe("max")
    }
  })

  test("variant is optional in CommandInput schema", async () => {
    // Verify backwards compatibility - variant should be optional
    const { SessionPrompt } = await import("../../src/session/prompt")

    // #when - parse input without variant
    const result = SessionPrompt.CommandInput.safeParse({
      sessionID: "ses_test456",
      command: "init",
      arguments: "",
    })

    // #then - schema should accept input without variant
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variant).toBeUndefined()
    }
  })

  test("prompt works without variant (backwards compatibility)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const session = await Session.create({})
        const app = Server.App()

        // #when - send a prompt without variant
        const response = await app.request(`/session/${session.id}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            noReply: true,
            parts: [{ type: "text", text: "test without variant" }],
          }),
        })

        // #then - request should be accepted
        expect(response.status).toBe(200)

        // Read the streamed response to get the created message
        const responseBody = await response.text()
        const msg = JSON.parse(responseBody)

        // Verify the user message was created without variant
        expect(msg.info).toBeDefined()
        expect(msg.info.role).toBe("user")
        expect(msg.info.variant).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })
})
