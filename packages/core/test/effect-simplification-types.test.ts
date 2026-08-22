import { expect, test } from "bun:test"
import { Effect } from "effect"

const source = Effect.succeed(1)
const exactUndefined: Effect.Effect<undefined> = source.pipe(Effect.as(undefined))
// @ts-expect-error Effect.asVoid widens the success type to void.
const voidSuccess: Effect.Effect<undefined> = source.pipe(Effect.asVoid)

test("Effect.as preserves the exact undefined success type", () => {
  expect(Effect.runSync(exactUndefined)).toBeUndefined()
  expect(Effect.runSync(voidSuccess)).toBeUndefined()
})
