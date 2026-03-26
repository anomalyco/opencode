import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

async function fill(sessionID: SessionID, count: number, time = (i: number) => Date.now() + i) {
  const ids = [] as MessageID[]
  for (let i = 0; i < count; i++) {
    const id = MessageID.ascending()
    ids.push(id)
    await Session.updateMessage({
      id,
      sessionID,
      role: "user",
      time: { created: time(i) },
      agent: "test",
      model: { providerID: "test", modelID: "test" },
      tools: {},
      mode: "",
    } as unknown as MessageV2.Info)
    await Session.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: id,
      type: "text",
      text: `m${i}`,
    })
  }
  return ids
}

describe("session messages endpoint", () => {
  test("returns cursor headers for older pages", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const ids = await fill(session.id, 5)
        const app = Server.Default()

        const a = await app.request(`/session/${session.id}/message?limit=2`)
        expect(a.status).toBe(200)
        const aBody = (await a.json()) as MessageV2.WithParts[]
        expect(aBody.map((item) => item.info.id)).toEqual(ids.slice(-2))
        const cursor = a.headers.get("x-next-cursor")
        expect(cursor).toBeTruthy()
        expect(a.headers.get("link")).toContain('rel="next"')

        const b = await app.request(`/session/${session.id}/message?limit=2&before=${encodeURIComponent(cursor!)}`)
        expect(b.status).toBe(200)
        const bBody = (await b.json()) as MessageV2.WithParts[]
        expect(bBody.map((item) => item.info.id)).toEqual(ids.slice(-4, -2))

        await Session.remove(session.id)
      },
    })
  })

  test("keeps full-history responses when limit is omitted", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const ids = await fill(session.id, 3)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/message`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as MessageV2.WithParts[]
        expect(body.map((item) => item.info.id)).toEqual(ids)

        await Session.remove(session.id)
      },
    })
  })

  test("rejects invalid cursors and missing sessions", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()

        const bad = await app.request(`/session/${session.id}/message?limit=2&before=bad`)
        expect(bad.status).toBe(400)

        const miss = await app.request(`/session/ses_missing/message?limit=2`)
        expect(miss.status).toBe(404)

        await Session.remove(session.id)
      },
    })
  })

  test("does not truncate large legacy limit requests", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        await fill(session.id, 520)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/message?limit=510`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as MessageV2.WithParts[]
        expect(body).toHaveLength(510)

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt_async error handling", () => {
  test("prompt_async route has error handler for detached prompt call", async () => {
    const src = await Bun.file(path.join(import.meta.dir, "../../src/server/routes/session.ts")).text()
    const start = src.indexOf('"/:sessionID/prompt_async"')
    const end = src.indexOf('"/:sessionID/command"', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const route = src.slice(start, end)
    expect(route).toContain(".catch(")
    expect(route).toContain("Bus.publish(Session.Event.Error")
  })
})
