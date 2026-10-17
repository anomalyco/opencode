import { describe, expect, test } from "bun:test"
import { errorFormat, errorMessage } from "../../src/util/error"
import { ClientError } from "@opencode/client/promise"

describe("util.error", () => {
  test("formats native Error instances", () => {
    const err = new Error("boom")
    expect(errorMessage(err)).toBe("boom")
    expect(errorFormat(err)).toContain("boom")
  })

  test("extracts message from record-like values", () => {
    const err = { message: "bad input", code: "E_BAD" }
    expect(errorMessage(err)).toBe("bad input")
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
  })

  test("explains refused and timed out service transports", () => {
    expect(errorMessage(new ClientError("Transport", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) })))
      .toContain("stopped or overloaded")
    expect(errorMessage(new ClientError("Transport", { cause: Object.assign(new Error("deadline"), { name: "TimeoutError" }) })))
      .toContain("request timed out")
  })

  test("shows HTTP status for server responses", () => {
    expect(errorMessage(new ClientError("UnexpectedStatus", { cause: { status: 503 }, detail: "503" }))).toBe("OpenCode returned HTTP 503.")
  })
})
