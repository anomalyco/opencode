import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { GlobalBus } from "../../src/bus/global"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session as SessionNs } from "../../src/session"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const COMMAND_BODY = {
  command: "/unknown-test-command",
  arguments: "",
}

afterEach(() => Instance.disposeAll())

describe("command_async route", () => {
  test("returns 204 immediately", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* SessionNs.Service
            const session = yield* sessions.create({})
            const app = Server.Default().app

            const start = Date.now()
            const res = yield* Effect.promise(() =>
              Promise.resolve(
                app.request(`/session/${session.id}/command_async`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(COMMAND_BODY),
                }),
              ),
            )
            const elapsed = Date.now() - start

            expect(res.status).toBe(204)
            // Handler must return before any background processing completes.
            expect(elapsed).toBeLessThan(2000)

            yield* sessions.remove(session.id)
          }),
        ),
    })
  })

  test("background failure publishes Session.Event.Error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* SessionNs.Service
            const session = yield* sessions.create({})

            // Resolve as soon as the error event arrives for this session.
            const errorReceived = Promise.withResolvers<string>()
            const onEvent = (evt: { payload: { type?: string; properties?: { sessionID?: string } } }) => {
              if (evt.payload.type === SessionNs.Event.Error.type && evt.payload.properties?.sessionID === session.id)
                errorReceived.resolve(evt.payload.properties.sessionID)
            }
            GlobalBus.on("event", onEvent)

            const app = Server.Default().app
            const res = yield* Effect.promise(() =>
              Promise.resolve(
                app.request(`/session/${session.id}/command_async`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(COMMAND_BODY),
                }),
              ),
            )

            expect(res.status).toBe(204)

            // /unknown-test-command is not registered; the background command will fail
            // and must surface via Session.Event.Error rather than being swallowed.
            const receivedID = yield* Effect.promise(() =>
              Promise.race([errorReceived.promise, Bun.sleep(10_000).then(() => null)]),
            )
            GlobalBus.off("event", onEvent)
            expect(receivedID).toBe(session.id)

            yield* sessions.remove(session.id)
          }),
        ),
    })
  }, 15_000)
})
