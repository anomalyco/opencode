import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../../opencode/src/session"
import { Log } from "../../../opencode/src/util/log"
import { Instance } from "../../../opencode/src/project/instance"
import { Server } from "../../../opencode/src/server/server"
import { AuthConfig } from "../../../opencode/src/config/auth"
import { ServerAuth } from "../../../opencode/src/config/server-auth"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("tui.selectSession endpoint", () => {
  test("should return 200 when called with valid session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        ServerAuth._setForTesting(AuthConfig.parse({ enabled: false }))
        try {
          // #given
          const session = await Session.create({})

          // #when
          const app = Server.App()
          const response = await app.request("/tui/select-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID: session.id }),
          })

          // #then
          expect(response.status).toBe(200)
          const body = await response.json()
          expect(body).toBe(true)

          await Session.remove(session.id)
        } finally {
          ServerAuth._reset()
        }
      },
    })
  })

  test("should return 404 when session does not exist", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        ServerAuth._setForTesting(AuthConfig.parse({ enabled: false }))
        try {
          // #given
          const nonExistentSessionID = "ses_nonexistent123"

          // #when
          const app = Server.App()
          const response = await app.request("/tui/select-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID: nonExistentSessionID }),
          })

          // #then
          expect(response.status).toBe(404)
        } finally {
          ServerAuth._reset()
        }
      },
    })
  })

  test("should return 400 when session ID format is invalid", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        ServerAuth._setForTesting(AuthConfig.parse({ enabled: false }))
        try {
          // #given
          const invalidSessionID = "invalid_session_id"

          // #when
          const app = Server.App()
          const response = await app.request("/tui/select-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID: invalidSessionID }),
          })

          // #then
          expect(response.status).toBe(400)
        } finally {
          ServerAuth._reset()
        }
      },
    })
  })
})
