import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("trigger routes", () => {
  test("creates and lists triggers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()

        const create = await app.request("/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval: 20 }),
        })

        expect(create.status).toBe(200)
        const item = await create.json()
        expect(item).toMatchObject({
          schedule: { interval: 20 },
          runs: 0,
        })

        await Bun.sleep(80)

        const list = await app.request("/trigger")
        expect(list.status).toBe(200)
        const body = await list.json()
        expect(body).toHaveLength(1)
        expect(body[0]).toMatchObject({
          id: item.id,
          schedule: { type: "interval", interval: 20 },
        })
        expect(body[0].runs).toBeGreaterThan(0)
      },
    })
  })
})
