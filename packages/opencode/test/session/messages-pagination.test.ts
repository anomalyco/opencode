import { describe, expect, test } from "bun:test"
import path from "path"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.messages pagination", () => {
  test("supports before cursor", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const ids: string[] = []

        for (let i = 0; i < 10; i++) {
          const id = Identifier.ascending("message")
          ids.push(id)
          await Session.updateMessage({
            id,
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "test",
            model: { providerID: "opencode", modelID: "test" },
          })
        }

        const page1 = await Session.messages({ sessionID: session.id, limit: 3 })
        expect(page1.map((x) => x.info.id)).toEqual(ids.slice(-3))

        const cursor1 = page1.at(0)?.info.id
        expect(cursor1).toBe(ids.at(-3))

        const page2 = await Session.messages({ sessionID: session.id, limit: 3, before: cursor1! })
        expect(page2.map((x) => x.info.id)).toEqual(ids.slice(-6, -3))

        const cursor2 = page2.at(0)?.info.id
        expect(cursor2).toBe(ids.at(-6))

        const page3 = await Session.messages({ sessionID: session.id, limit: 3, before: cursor2! })
        expect(page3.map((x) => x.info.id)).toEqual(ids.slice(-9, -6))

        const cursor3 = page3.at(0)?.info.id
        expect(cursor3).toBe(ids.at(-9))

        const page4 = await Session.messages({ sessionID: session.id, limit: 3, before: cursor3! })
        expect(page4.map((x) => x.info.id)).toEqual(ids.slice(0, 1))

        const cursor4 = page4.at(0)?.info.id
        expect(cursor4).toBe(ids.at(0))

        const page5 = await Session.messages({ sessionID: session.id, limit: 3, before: cursor4! })
        expect(page5).toEqual([])

        await Session.remove(session.id)
      },
    })
  })
})

