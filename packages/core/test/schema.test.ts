import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { optionalOmitUndefined } from "@opencode-ai/core/schema"
import { V2Schema } from "@opencode-ai/core/v2-schema"

describe("optionalOmitUndefined", () => {
  test("omits undefined while preserving transformed schema encoding", () => {
    const schema = Schema.Struct({
      timestamp: optionalOmitUndefined(V2Schema.DateTimeUtcFromMillis),
    })

    expect(Schema.encodeUnknownSync(schema)({ timestamp: DateTime.makeUnsafe(123) })).toEqual({ timestamp: 123 })
    expect(Object.hasOwn(Schema.encodeUnknownSync(schema)({ timestamp: undefined }), "timestamp")).toBe(false)
  })
})
