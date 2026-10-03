import { expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2"
import { compareMessage } from "../../src/context/sync"

const message = (id: string, created: number) => ({ id, time: { created } }) as Message

test("orders messages by creation time, then by raw id like storage", () => {
  const upper = message("msg_A1", 1)
  const lower = message("msg_a1", 1)
  const earlier = message("msg_z9", 0)
  const later = message("msg_00", 2)
  const expected = [earlier, upper, lower, later].map((item) => item.id)

  // Storage uses SQLite BINARY collation, where "A" < "a"; locale collation puts "a" first.
  expect([later, lower, earlier, upper].toSorted(compareMessage).map((item) => item.id)).toEqual(expected)
  expect([upper, later, lower, earlier].toSorted(compareMessage).map((item) => item.id)).toEqual(expected)
})

test("never treats distinct ids as equal", () => {
  // Canonically equivalent under locale collation, but distinct primary keys.
  const composed = message("msg_é", 1)
  const decomposed = message("msg_é", 1)

  expect(compareMessage(composed, decomposed)).not.toBe(0)
  expect(compareMessage(composed, decomposed)).toBe(-compareMessage(decomposed, composed))
})
