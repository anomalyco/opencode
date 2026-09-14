import { expect } from "bun:test"
import { Effect, Option, Result } from "effect"
import { it } from "../../core/test/lib/effect"
import { runPtySocket } from "../src/handlers/pty-socket"

it.live("detaches when the socket fails while the outbox drain is blocked", () =>
  Effect.gen(function* () {
    const state = { detached: false }
    const result = yield* runPtySocket(Effect.never, Effect.fail("socket closed"), () => {
      state.detached = true
    }).pipe(Effect.result, Effect.timeoutOption("100 millis"))

    expect(Option.isSome(result) && Result.isFailure(result.value)).toBeTrue()
    expect(state.detached).toBeTrue()
  }),
)
