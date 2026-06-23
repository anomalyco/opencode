import { describe, expect, test } from "bun:test"
import { NamedError, causeMessage, errorMessage } from "@opencode-ai/core/util/error"
import { Cause, Schema } from "effect"

class StructuredError extends Schema.TaggedErrorClass<StructuredError>()("StructuredError", {
  resource: Schema.String,
}) {}

describe("errorMessage", () => {
  test("always returns useful text for unknown errors", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage(new Error())).toBe("Error")
    expect(errorMessage(new StructuredError({ resource: "model" }))).toBe("StructuredError")
    expect(errorMessage({})).toBe("Unknown error")
    expect(errorMessage(undefined)).toBe("Unknown error")
  })

  test("prefers NamedError data over its generic native message", () => {
    expect(errorMessage(new NamedError.Unknown({ message: "specific failure" }))).toBe("specific failure")
  })
})

describe("causeMessage", () => {
  test("renders typed failures and defects without squashing", () => {
    expect(causeMessage(Cause.fail(new Error("typed failure")))).toBe("typed failure")
    expect(causeMessage(Cause.die(new Error("defect")))).toBe("defect")
  })
})
