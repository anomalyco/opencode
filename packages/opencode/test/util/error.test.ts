import { describe, expect, test } from "bun:test"
import { NamedError } from "@opencode-ai/core/util/error"
import { MessageError } from "../../src/session/message-error"

describe("util.error", () => {
  test("schema-backed named errors are real NamedError instances", () => {
    const error = new MessageError.AuthError({ providerID: "anthropic", message: "boom" })

    expect(error).toBeInstanceOf(NamedError)
    expect(error.toObject()).toEqual({ name: "ProviderAuthError", data: { providerID: "anthropic", message: "boom" } })
  })

  test("named errors without fields serialize data", () => {
    expect(new MessageError.OutputLengthError({}).toObject()).toEqual({ name: "MessageOutputLengthError", data: {} })
  })
})
