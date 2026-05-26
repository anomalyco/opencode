import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Option, Stream } from "effect"
import { LLMStreamIdleTimeout, withIdleTimeout } from "../../src/session/llm"

describe("session.llm.withIdleTimeout", () => {
  test("fails with LLMStreamIdleTimeout when no event arrives within the idle window", async () => {
    const stalled = Stream.never as Stream.Stream<number>
    const exit = await Effect.runPromiseExit(Stream.runCollect(withIdleTimeout(stalled, 30)))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Cause.findErrorOption(exit.cause)
      expect(Option.isSome(err) && err.value instanceof LLMStreamIdleTimeout).toBe(true)
    }
  })

  test("emits early events then fails when the stream stalls", async () => {
    const partial = Stream.make(1, 2).pipe(Stream.concat(Stream.never as Stream.Stream<number>))
    const collected: number[] = []
    const exit = await Effect.runPromiseExit(
      Stream.runForEach(withIdleTimeout(partial, 30), (n) =>
        Effect.sync(() => {
          collected.push(n)
        }),
      ),
    )
    expect(collected).toEqual([1, 2])
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("does not interfere with streams that complete before the idle window", async () => {
    const ok = Stream.make("a", "b", "c")
    const out = await Effect.runPromise(Stream.runCollect(withIdleTimeout(ok, 1_000)))
    expect(Array.from(out)).toEqual(["a", "b", "c"])
  })
})
