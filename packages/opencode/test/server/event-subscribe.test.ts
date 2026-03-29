import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Flag } from "../../src/flag/flag"
import { Database, eq } from "../../src/storage/db"
import { EventTable } from "../../src/sync/event.sql"
import { Bus } from "../../src/bus"

const workspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const queue = Flag.OPENCODE_EXPERIMENTAL_EVENT_QUEUE_MAX

beforeEach(async () => {
  await resetDatabase()
})

afterEach(() => {
  // @ts-expect-error test override
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = workspaces
  // @ts-expect-error test override
  Flag.OPENCODE_EXPERIMENTAL_EVENT_QUEUE_MAX = queue
})

describe("server /event", () => {
  test("returns stream.expired when replay is requested and workspaces are disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // @ts-expect-error test override
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = false
        await Session.create({ title: "event-expired" })

        const app = Server.Default()
        const res = await app.request("/event?after_seq=0")
        expect(res.status).toBe(200)
        const body = await res.text()
        expect(body).toContain("server.stream.expired")
      },
    })
  })

  test("returns stream.expired when replay cursor is older than oldest event", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // @ts-expect-error test override
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const session = await Session.create({ title: "event-old-cursor" })
        await Session.setTitle({ sessionID: session.id, title: "event-old-cursor-2" })
        Database.use((db) => db.delete(EventTable).where(eq(EventTable.seq, 0)).run())

        const app = Server.Default()
        const res = await app.request("/event?after_seq=0")
        expect(res.status).toBe(200)
        const body = await res.text()
        expect(body).toContain("server.stream.expired")
      },
    })
  })

  test("replays existing events when cursor is valid", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // @ts-expect-error test override
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const session = await Session.create({ title: "event-replay" })
        await Session.setTitle({ sessionID: session.id, title: "event-replay-2" })

        const app = Server.Default()
        const res = await app.request("/event?after_seq=0")
        expect(res.status).toBe(200)
        const body = await res.text()
        expect(body).toContain("session.updated")
      },
    })
  })

  test("returns stream.expired for malformed replay cursor", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // @ts-expect-error test override
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const app = Server.Default()
        const res = await app.request("/event?after_seq=bad")
        expect(res.status).toBe(200)
        const body = await res.text()
        expect(body).toContain("server.stream.expired")
      },
    })
  })

  test("keeps replay contract with tiny queue size", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // @ts-expect-error test override
        Flag.OPENCODE_EXPERIMENTAL_EVENT_QUEUE_MAX = 1

        // @ts-expect-error test override
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = false
        const app = Server.Default()
        const expired = await app.request("/event?after_seq=0")
        expect(expired.status).toBe(200)
        expect(await expired.text()).toContain("server.stream.expired")

        // @ts-expect-error test override
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const session = await Session.create({ title: "event-small-queue" })
        await Session.setTitle({ sessionID: session.id, title: "event-small-queue-2" })

        const replay = await app.request("/event?after_seq=0")
        expect(replay.status).toBe(200)
        const body = await replay.text()
        expect(body).toContain("session.updated")
      },
    })
  })

  test("emits stream.lagged on overflow", async () => {
    await using tmp = await tmpdir({ git: true })
    const original = Bus.subscribeAll
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // @ts-expect-error test override
        Flag.OPENCODE_EXPERIMENTAL_EVENT_QUEUE_MAX = 1
        const app = Server.Default()

        Bus.subscribeAll = (callback: (event: any) => unknown) => {
          for (let i = 0; i < 2000; i++) {
            callback({
              type: "test.event.overflow",
              properties: { index: i, value: "x".repeat(128) },
            })
          }
          return () => {}
        }

        const stream = await app.request("/event")

        expect(stream.status).toBe(200)
        const body = await stream.text()
        expect(body).toContain("server.stream.lagged")
      },
    })
    Bus.subscribeAll = original
  })
})
