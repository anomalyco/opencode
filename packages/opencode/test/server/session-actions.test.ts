import { afterEach, describe, expect, mock, test } from "bun:test"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { Server } from "../../src/server/server"
import { Session as SessionNs } from "@/session/session"
import type { SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  remove(id: SessionID) {
    return run(SessionNs.Service.use((svc) => svc.remove(id)))
  },
}

afterEach(async () => {
  mock.restore()
  await disposeAllInstances()
})

describe("session action routes", () => {
  test("session routes expose metadata on create, update, get, and fork", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default().app

        const created = await app.request("/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "meta-session",
            metadata: { source: "sdk", trace: { id: "abc" } },
          }),
        })
        expect(created.status).toBe(200)

        const session = (await created.json()) as SessionNs.Info
        expect(session.metadata).toEqual({ source: "sdk", trace: { id: "abc" } })

        const updated = await app.request(`/session/${session.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: { source: "sdk", trace: { id: "def" }, tags: ["one"] } }),
        })
        expect(updated.status).toBe(200)

        const next = (await updated.json()) as SessionNs.Info
        expect(next.metadata).toEqual({ source: "sdk", trace: { id: "def" }, tags: ["one"] })

        const fetched = await app.request(`/session/${session.id}`)
        expect(fetched.status).toBe(200)
        expect(((await fetched.json()) as SessionNs.Info).metadata).toEqual(next.metadata)

        const forked = await app.request(`/session/${session.id}/fork`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
        expect(forked.status).toBe(200)

        const fork = (await forked.json()) as SessionNs.Info
        expect(fork.metadata).toEqual(next.metadata)

        const blanked = await app.request(`/session/${session.id}/fork`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ copyMetadata: false }),
        })
        expect(blanked.status).toBe(200)
        const empty = (await blanked.json()) as SessionNs.Info
        expect(empty.metadata).toEqual({})

        const cleared = await app.request(`/session/${session.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: null }),
        })
        expect(cleared.status).toBe(200)
        expect(((await cleared.json()) as SessionNs.Info).metadata).toEqual({})

        await svc.remove(fork.id)
        await svc.remove(empty.id)
        await svc.remove(session.id)
      },
    })
  })

  test("abort route returns success", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/abort`, { method: "POST" })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)

        await svc.remove(session.id)
      },
    })
  })
})
