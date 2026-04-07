import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

describe("session status route", () => {
  test("accepts status with messageID", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "working", messageID: "msg-123" }),
        })

        expect(res.status).toBe(200)
        expect(await res.text()).toBe("ok")

        await Session.remove(session.id)
      },
    })
  })

  // Regression: messageID was required in the zod validator but oc status
  // only sends it when OPENCODE_MESSAGE_ID is set. Without this fix,
  // oc status calls without a messageID would 400.
  test("accepts status without messageID", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "working" }),
        })

        // Without messageID the emitter is a no-op, but the route must not 400
        expect(res.status).toBe(200)
        expect(await res.text()).toBe("ok")

        await Session.remove(session.id)
      },
    })
  })

  test("rejects status without message field", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(400)

        await Session.remove(session.id)
      },
    })
  })
})
