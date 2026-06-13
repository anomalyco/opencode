import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { it } from "../lib/effect"

void Log.init({ print: false })

const makeFreshStatus = Effect.gen(function* () {
  const context = yield* Layer.build(Layer.fresh(SessionStatus.defaultLayer))
  return Context.get(context, SessionStatus.Service)
})

it.instance(
  "shares status across fresh service instances for the same directory",
  Effect.gen(function* () {
    const first = yield* makeFreshStatus
    const second = yield* makeFreshStatus
    const sessionID = SessionID.make("ses_status_shared")

    yield* first.set(sessionID, { type: "busy" })
    expect(yield* second.get(sessionID)).toEqual({ type: "busy" })

    yield* second.set(sessionID, { type: "idle" })
    expect(yield* first.get(sessionID)).toEqual({ type: "idle" })
  }),
)
