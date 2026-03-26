import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session weave endpoint", () => {
  test("returns weave state for existing session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/weave`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as { sessionID: string; version: number }
        expect(body.sessionID).toBe(session.id)
        expect(body.version).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("returns 404 for missing session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/session/ses_missing/weave")
        expect(res.status).toBe(404)
      },
    })
  })
})
