import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Trigger } from "../../src/trigger"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function auth(password: string, username = "opencode") {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

beforeEach(async () => {
  await resetDatabase()
})

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

  test("returns trigger detail with current enabled state", async () => {
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
        const item = await create.json()

        const off = await app.request(`/trigger/${item.id}/disable`, {
          method: "POST",
        })
        expect(off.status).toBe(200)

        const detail = await app.request(`/trigger/${item.id}`)
        expect(detail.status).toBe(200)
        expect(await detail.json()).toMatchObject({
          id: item.id,
          enabled: false,
          schedule: { type: "interval", interval: 20 },
        })
      },
    })
  })

  test("enables and deletes triggers", async () => {
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
        const item = await create.json()

        const off = await app.request(`/trigger/${item.id}/disable`, {
          method: "POST",
        })
        expect(off.status).toBe(200)

        const on = await app.request(`/trigger/${item.id}/enable`, {
          method: "POST",
        })
        expect(on.status).toBe(200)
        expect(await on.json()).toMatchObject({ id: item.id, enabled: true })

        const del = await app.request(`/trigger/${item.id}`, {
          method: "DELETE",
        })
        expect(del.status).toBe(200)

        const list = await app.request("/trigger")
        expect(await list.json()).toEqual([])

        const detail = await app.request(`/trigger/${item.id}`)
        expect(detail.status).toBe(404)
      },
    })
  })

  test("fires trigger now and returns updated state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const create = await app.request("/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval: 5_000 }),
        })
        const item = await create.json()

        const fire = await app.request(`/trigger/${item.id}/fire`, {
          method: "POST",
        })

        expect(fire.status).toBe(200)
        expect(await fire.json()).toMatchObject({
          id: item.id,
          runs: 1,
          time: {
            created: item.time.created,
            last: expect.any(Number),
          },
        })
      },
    })
  })

  test("fires trigger from webhook endpoint", async () => {
    await using tmp = await tmpdir({ git: true })
    const item = await Instance.provide({
      directory: tmp.path,
      fn: () => Trigger.create({ interval: 5_000 }),
    })
    const app = Server.ControlPlaneRoutes()

    const fire = await app.request(`/trigger/${item.id}/fire/webhook?directory=${encodeURIComponent(tmp.path)}`, {
      method: "POST",
    })

    expect(fire.status).toBe(200)
    expect(await fire.json()).toMatchObject({
      id: item.id,
      runs: 1,
      time: {
        created: item.time.created,
        last: expect.any(Number),
      },
    })
  })

  test("requires server auth for webhook trigger fire", async () => {
    await using tmp = await tmpdir({ git: true })
    const item = await Instance.provide({
      directory: tmp.path,
      fn: () => Trigger.create({ interval: 5_000 }),
    })
    const prev = process.env.OPENCODE_SERVER_PASSWORD
    delete process.env.OPENCODE_SERVER_USERNAME
    process.env.OPENCODE_SERVER_PASSWORD = "secret"

    try {
      const app = Server.ControlPlaneRoutes()
      const url = `/trigger/${item.id}/fire/webhook?directory=${encodeURIComponent(tmp.path)}`

      const bad = await app.request(url, { method: "POST" })
      expect(bad.status).toBe(401)

      const good = await app.request(url, {
        method: "POST",
        headers: {
          Authorization: auth("secret"),
        },
      })

      expect(good.status).toBe(200)
      expect(await good.json()).toMatchObject({ id: item.id, runs: 1 })
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
      else process.env.OPENCODE_SERVER_PASSWORD = prev
    }
  })
})
