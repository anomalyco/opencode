import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import { errorData, errorFormat, errorMessage } from "../../src/util/error"
import { UI } from "../../src/cli/ui"
import { MessageError } from "../../src/session/message-error"

describe("util.error", () => {
  test("formats native Error instances", () => {
    const err = new Error("boom")
    expect(errorMessage(err)).toBe("boom")
    expect(errorFormat(err)).toContain("boom")

    const data = errorData(err)
    expect(data.type).toBe("Error")
    expect(data.message).toBe("boom")
    expect(String(data.formatted)).toContain("boom")
  })

  test("extracts message from record-like values", () => {
    const err = { message: "bad input", code: "E_BAD" }
    expect(errorMessage(err)).toBe("bad input")

    const data = errorData(err)
    expect(data.message).toBe("bad input")
    expect(data.code).toBe("E_BAD")
  })

  test("never returns bare {} for opaque object errors", () => {
    // Plain empty object — what the SDK threw before we wrapped it.
    expect(errorFormat({})).not.toBe("{}")
    expect(errorFormat({})).toContain("no message")

    // Object with only non-enumerable own properties (JSON.stringify drops them).
    class OpaqueError {}
    const opaque = new OpaqueError()
    Object.defineProperty(opaque, "secret", { value: "hidden", enumerable: false })
    expect(errorFormat(opaque)).not.toBe("{}")
    expect(errorFormat(opaque)).toContain("OpaqueError")
  })

  test("handles opaque throwables with custom toString", () => {
    const err = {
      toString() {
        return "ResolveMessage: Cannot resolve module"
      },
    }

    expect(errorMessage(err)).toBe("ResolveMessage: Cannot resolve module")

    const data = errorData(err)
    expect(data.message).toBe("ResolveMessage: Cannot resolve module")
    expect(String(data.formatted)).toContain("ResolveMessage")
  })

  test("schema-backed named errors are real NamedError instances", () => {
    const error = new MessageError.AuthError({ providerID: "anthropic", message: "boom" })

    expect(error).toBeInstanceOf(NamedError)
    expect(error.toObject()).toEqual({ name: "ProviderAuthError", data: { providerID: "anthropic", message: "boom" } })
  })

  test("void named errors accept JSON without data", () => {
    const serialized = JSON.parse(JSON.stringify(new UI.CancelledError(undefined).toObject()))

    expect(Schema.decodeUnknownOption(UI.CancelledError.Schema)(serialized)._tag).toBe("Some")
  })
})
