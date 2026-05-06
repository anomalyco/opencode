import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { WithInstance } from "../../src/project/with-instance"
import { Server } from "../../src/server/server"
import { Session as SessionNs } from "@/session/session"
import type { SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { waitGlobalBusEventPromise } from "./global-bus"

void Log.init({ print: false })

const COMMAND_BODY = {
  command: "/unknown-test-command",
  arguments: "",
  model: {
    providerID: "test",
    modelID: "test-model",
  },
}

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
  await disposeAllInstances()
})

describe("command_async route", () => {
  test("returns 204 immediately", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const app = Server.Default().app

        const start = Date.now()
        const res = await app.request(`/session/${session.id}/command_async`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(COMMAND_BODY),
        })
        const elapsed = Date.now() - start

        expect(res.status).toBe(204)
        // Handler must return before any background processing completes.
        expect(elapsed).toBeLessThan(2000)

        await svc.remove(session.id)
      },
    })
  })

  test("background failure publishes Session.Event.Error", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const errorReceived = waitGlobalBusEventPromise({
          predicate: (event) =>
            event.payload.type === SessionNs.Event.Error.type && event.payload.properties?.sessionID === session.id,
        })

        const app = Server.Default().app
        const res = await app.request(`/session/${session.id}/command_async`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(COMMAND_BODY),
        })

        expect(res.status).toBe(204)

        // /unknown-test-command is not registered; the background command will fail
        // and must surface via Session.Event.Error rather than being swallowed.
        expect((await errorReceived).payload.properties?.sessionID).toBe(session.id)

        await svc.remove(session.id)
      },
    })
  }, 15_000)
})
