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
