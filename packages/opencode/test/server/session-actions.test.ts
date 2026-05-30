import { afterEach, describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { Server } from "../../src/server/server"
import { Session as SessionNs } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const it = testEffect(SessionNs.defaultLayer)

afterEach(async () => {
  mock.restore()
  await disposeAllInstances()
})

describe("session action routes", () => {
  it.instance(
    "session routes expose metadata on create, update, get, and fork",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const app = Server.Default().app
        const headers = { "Content-Type": "application/json", "x-opencode-directory": test.directory }

        const created = yield* Effect.promise(() =>
          Promise.resolve(
            app.request("/session", {
              method: "POST",
              headers,
              body: JSON.stringify({
                title: "meta-session",
                metadata: { source: "sdk", trace: { id: "abc" } },
              }),
            }),
          ),
        )
        expect(created.status).toBe(200)

        const session = (yield* Effect.promise(() => created.json())) as SessionNs.Info
        expect(session.metadata).toEqual({ source: "sdk", trace: { id: "abc" } })

        const updated = yield* Effect.promise(() =>
          Promise.resolve(
            app.request(`/session/${session.id}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify({ metadata: { source: "sdk", trace: { id: "def" }, tags: ["one"] } }),
            }),
          ),
        )
        expect(updated.status).toBe(200)

        const next = (yield* Effect.promise(() => updated.json())) as SessionNs.Info
        expect(next.metadata).toEqual({ source: "sdk", trace: { id: "def" }, tags: ["one"] })

        const fetched = yield* Effect.promise(() =>
          Promise.resolve(
            app.request(`/session/${session.id}`, { headers: { "x-opencode-directory": test.directory } }),
          ),
        )
        expect(fetched.status).toBe(200)
        expect(((yield* Effect.promise(() => fetched.json())) as SessionNs.Info).metadata).toEqual(next.metadata)

        const forked = yield* Effect.promise(() =>
          Promise.resolve(
            app.request(`/session/${session.id}/fork`, {
              method: "POST",
              headers,
              body: JSON.stringify({}),
            }),
          ),
        )
        expect(forked.status).toBe(200)

        const fork = (yield* Effect.promise(() => forked.json())) as SessionNs.Info
        expect(fork.metadata).toEqual(next.metadata)

        const reset = yield* Effect.promise(() =>
          Promise.resolve(
            app.request(`/session/${session.id}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify({ metadata: {} }),
            }),
          ),
        )
        expect(reset.status).toBe(200)
        expect(((yield* Effect.promise(() => reset.json())) as SessionNs.Info).metadata).toEqual({})

        yield* SessionNs.Service.use((svc) => svc.remove(fork.id).pipe(Effect.ignore))
        yield* SessionNs.Service.use((svc) => svc.remove(session.id).pipe(Effect.ignore))
      }),
    { git: true },
  )

  it.instance(
    "abort route returns success",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Effect.acquireRelease(SessionNs.use.create({}), (created) =>
          SessionNs.use.remove(created.id).pipe(Effect.ignore),
        )

        const res = yield* Effect.promise(() =>
          Promise.resolve(
            Server.Default().app.request(`/session/${session.id}/abort`, {
              method: "POST",
              headers: { "x-opencode-directory": test.directory },
            }),
          ),
        )

        expect(res.status).toBe(200)
        expect(yield* Effect.promise(() => res.json())).toBe(true)
      }),
    { git: true },
  )
})
