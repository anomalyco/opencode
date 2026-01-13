import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { AuthToken } from "../../src/auth/token"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Test auth token for authenticated requests
let testToken: string

beforeAll(async () => {
  const tokenInfo = await AuthToken.create({
    permissions: ["read", "write", "execute"],
    expiry: "never",
    name: "test-token",
  })
  testToken = tokenInfo.token
})

afterAll(async () => {
  if (testToken) {
    await AuthToken.remove(testToken)
  }
})

describe("tui.selectSession endpoint", () => {
  test("should return 200 when called with valid session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const session = await Session.create({})

        // #when
        const app = Server.App()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${testToken}`,
          },
          body: JSON.stringify({ sessionID: session.id }),
        })

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
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${testToken}`,
          },
          body: JSON.stringify({ sessionID: nonExistentSessionID }),
        })

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
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${testToken}`,
          },
          body: JSON.stringify({ sessionID: invalidSessionID }),
        })

        // #then
        expect(response.status).toBe(400)
      },
    })
  })

  test("should return 401 when no auth token provided", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #when
        const app = Server.App()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: "ses_test123" }),
        })

        // #then
        expect(response.status).toBe(401)
      },
    })
  })
})
