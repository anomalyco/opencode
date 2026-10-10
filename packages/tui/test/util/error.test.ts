import { describe, expect, test } from "bun:test"
import { Npm } from "@opencode/util/npm"
import { errorFormat, errorMessage } from "../../src/util/error"

describe("util.error", () => {
  test("formats native Error instances", () => {
    const err = new Error("boom")
    expect(errorMessage(err)).toBe("boom")
    expect(errorFormat(err)).toContain("boom")
  })

  test("includes install failure causes in plugin reconciliation messages", () => {
    const cause = new Error("unable to resolve dependency tree")
    const error = new Npm.InstallFailedError({ add: ["fixture-plugin@1.0.0"], dir: "/cache/npm", cause })

    expect(errorMessage(error)).toContain("fixture-plugin@1.0.0")
    expect(errorMessage(error)).toContain(cause.message)
    expect(error.cause).toBe(cause)
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
})
