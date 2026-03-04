import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.update endpoint", () => {
  test("supports unarchive with null", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "archived-session" })
        await Session.setArchived({ sessionID: session.id, time: Date.now() })

        const app = Server.App()
        const response = await app.request(`/session/${session.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ time: { archived: null } }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.time.archived).toBeUndefined()

        const updated = await Session.get(session.id)
        expect(updated.time.archived).toBeUndefined()
      },
    })
  })
})
