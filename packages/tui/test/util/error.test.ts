import { describe, expect, test } from "bun:test"
import { errorData, errorFormat, errorMessage } from "../../src/util/error"

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
    expect(errorFormat({})).not.toBe("{}")
    expect(errorFormat({})).toContain("no message")

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

  test("surfaces the cause when a tagged error has no message", () => {
    // Effect's `Data.TaggedError` subclasses (e.g. `ServeError`) leave `message`
    // empty and park the real failure on `cause`. Printing the bare name told
    // the user nothing.
    const inner = Object.assign(new Error("listen EADDRINUSE: address already in use"), { code: "EADDRINUSE" })
    const tagged = new Error("")
    tagged.name = "ServeError"
    Object.assign(tagged, { _tag: "ServeError", cause: inner })

    expect(errorMessage(tagged)).toBe("ServeError: listen EADDRINUSE: address already in use")
  })

  test("still falls back to the name when the cause is empty too", () => {
    const tagged = new Error("")
    tagged.name = "ServeError"
    Object.assign(tagged, { cause: null })

    expect(errorMessage(tagged)).toBe("ServeError")
  })

  test("prefers an explicit message over the cause", () => {
    const err = new Error("outer", { cause: new Error("inner") })
    expect(errorMessage(err)).toBe("outer")
  })
})
