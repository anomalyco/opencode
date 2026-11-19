import { describe, expect, test } from "bun:test"
import { errorFormat, errorMessage } from "../../src/util/error"

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

  // Effect's Schema.TaggedError leaves `message` empty and falls back to the tag
  // in `name`, so a failure like an npm ERESOLVE exists only on `cause`.
  class TaggedError extends Error {
    override name = "NpmInstallFailedError"
  }

  test("surfaces the cause when a tagged error carries no message", () => {
    const err = Object.assign(new TaggedError(), { cause: new Error("unable to resolve dependency tree") })

    expect(errorMessage(err)).toBe("unable to resolve dependency tree")
  })

  test("keeps the tag when a tagged error has no usable cause", () => {
    expect(errorMessage(new TaggedError())).toBe("NpmInstallFailedError")
    expect(errorMessage(Object.assign(new TaggedError(), { cause: new Error("") }))).toBe("NpmInstallFailedError")
  })

  test("prefers a real message over its cause", () => {
    expect(errorMessage(new Error("Failed to load plugin", { cause: new Error("ENOENT") }))).toBe(
      "Failed to load plugin",
    )
  })

  test("walks a chained cause", () => {
    const err = Object.assign(new TaggedError(), { cause: Object.assign(new Error(), { cause: new Error("root") }) })

    expect(errorMessage(err)).toBe("root")
  })

  test("does not loop on a self-referencing cause", () => {
    const err = new TaggedError()
    Object.defineProperty(err, "cause", { value: err, enumerable: false })

    expect(errorMessage(err)).toBe("NpmInstallFailedError")
  })
})
