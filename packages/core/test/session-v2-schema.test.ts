import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { V2Schema } from "@opencode-ai/core/v2-schema"

const ArchivedField = Schema.optional(V2Schema.DateTimeUtcFromMillis)
const decodeArchived = Schema.decodeUnknownSync(ArchivedField as any)
const encodeArchived = Schema.encodeUnknownSync(ArchivedField as any)

describe("SessionV2.Info.time.archived field schema", () => {
  // Regression guard for #30109. The previous wrapper
  // `optionalOmitUndefined(V2Schema.DateTimeUtcFromMillis)` inverted the
  // direction of the inner decodeTo transform: encoding a DateTime crashed
  // with "Expected DateTime.Utc, got <number>" and decoding a number
  // crashed with "Expected number | undefined, got DateTime.Utc". Replacing
  // it with plain `Schema.optional` keeps the wire format identical to the
  // bare `DateTimeUtcFromMillis` field and round-trips cleanly.
  test("decodes a number to DateTime", () => {
    const result = decodeArchived(1_780_160_907_969)
    expect(DateTime.toEpochMillis(result as DateTime.Utc)).toBe(1_780_160_907_969)
  })

  test("decodes omitted key to undefined", () => {
    const result = decodeArchived(undefined)
    expect(result).toBeUndefined()
  })

  test("encodes DateTime to a number", () => {
    const result = encodeArchived(DateTime.makeUnsafe(1_780_160_907_969))
    expect(result).toBe(1_780_160_907_969)
  })

  test("encodes undefined to omitted key (no wire-format change)", () => {
    const result = encodeArchived(undefined)
    expect(result).toBeUndefined()
  })
})

