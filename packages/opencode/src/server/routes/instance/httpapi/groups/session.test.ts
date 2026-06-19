import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { UpdatePayload } from "./session"

describe("Session UpdatePayload", () => {
  test("accepts null archived time to restore archived sessions", () => {
    expect(Schema.decodeUnknownSync(UpdatePayload)({ time: { archived: null } })).toEqual({
      time: { archived: null },
    })
  })
})
