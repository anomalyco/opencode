import { afterEach, describe, expect, mock, spyOn } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(
    Session.defaultLayer,
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    Bus.layer,
  ),
)

async function user(sessionID: SessionID, text: string) {
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: msg.id,
    type: "text",
    text,
  })
  return msg
}

describe("session action routes", () => {
  it.live("abort route calls SessionPrompt.cancel", () =>
    provideTmpdirInstance({ git: true })(
      Effect.gen(function* () {
        const session = yield* Effect.promise(() => Session.create({}))
        const cancel = spyOn(SessionPrompt, "cancel").mockResolvedValue()
        const app = Server.Default().app

        const res = yield* Effect.promise(() =>
          app.request(`/session/${session.id}/abort`, { method: "POST" }),
        )

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(cancel).toHaveBeenCalledWith(session.id)

        yield* Effect.promise(() => Session.remove(session.id))
      }),
    ),
  )

  it.live("delete message route returns 400 when session is busy", () =>
    provideTmpdirInstance({ git: true })(
      Effect.gen(function* () {
        const session = yield* Effect.promise(() => Session.create({}))
        const msg = yield* Effect.promise(() => user(session.id, "hello"))

        // Make session busy: fork a never-ending runner and wait for status
        const state = yield* SessionRunState.Service
        const status = yield* SessionStatus.Service
        yield* Effect.fork(state.ensureRunning(session.id, Effect.never, Effect.never))
        yield* Effect.fn("waitBusy")(function* () {
          while ((yield* status.get(session.id)).type !== "busy") {
            yield* Effect.sleep("5 millis")
          }
        })()

        const remove = spyOn(Session, "removeMessage").mockResolvedValue(msg.id)
        const app = Server.Default().app

        const res = yield* Effect.promise(() =>
          app.request(`/session/${session.id}/message/${msg.id}`, { method: "DELETE" }),
        )

        expect(res.status).toBe(400)
        expect(remove).not.toHaveBeenCalled()

        yield* Effect.promise(() => Session.remove(session.id))
      }),
    ),
  )
})
