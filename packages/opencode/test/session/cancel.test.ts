import { describe, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, Session.Service | SessionPrompt.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Layer.mergeAll(Session.defaultLayer, SessionPrompt.defaultLayer))))
}

const svc = {
  cancel(sessionID: SessionID) {
    return run(SessionPrompt.Service.use((svc) => svc.cancel(sessionID)))
  },
}

describe("SessionPrompt.cancel", () => {
  test("cancel on non-existent session does not throw", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.cancel(SessionID.make("ses_nonexistent"))
      },
    })
  })
})
