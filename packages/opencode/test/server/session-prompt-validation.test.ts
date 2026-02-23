import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.prompt validation endpoint", () => {
  test("returns 400 for text-only whitespace prompt", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.App()

        const response = await app.request(`/session/${session.id}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            noReply: true,
            parts: [{ type: "text", text: "   " }],
          }),
        })

        expect(response.status).toBe(400)
        expect(await response.text()).toContain("Prompt cannot be empty")
      },
    })
  })

  test("returns 200 for valid prompt", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.App()

        const response = await app.request(`/session/${session.id}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          }),
        })

        expect(response.status).toBe(200)
      },
    })
  })
})
