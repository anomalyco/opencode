import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

const password = process.env.OPENCODE_SERVER_PASSWORD
const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
const auth = password ? "Basic " + Buffer.from(`${username}:${password}`).toString("base64") : undefined

const request = (app: ReturnType<typeof Server.App>, url: string, body: Record<string, unknown>) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (auth) headers.Authorization = auth
  return app.request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

describe("tui.selectSession endpoint", () => {
  test("should return 200 when called with valid session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const session = await Session.create({})

        // #when
        const app = Server.App()
        const response = await request(app, "/tui/select-session", { sessionID: session.id })

        // #then
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("should return 404 when session does not exist", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const nonExistentSessionID = "ses_nonexistent123"

        // #when
        const app = Server.App()
        const response = await request(app, "/tui/select-session", { sessionID: nonExistentSessionID })

        // #then
        expect(response.status).toBe(404)
      },
    })
  })

  test("should return 400 when session ID format is invalid", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const invalidSessionID = "invalid_session_id"

        // #when
        const app = Server.App()
        const response = await request(app, "/tui/select-session", { sessionID: invalidSessionID })

        // #then
        expect(response.status).toBe(400)
      },
    })
  })
})
