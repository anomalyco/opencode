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
  it.instance("abort route returns success", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const session = yield* Effect.acquireRelease(
        SessionNs.Service.use((svc) => svc.create({})),
        (created) => SessionNs.Service.use((svc) => svc.remove(created.id)).pipe(Effect.ignore),
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
