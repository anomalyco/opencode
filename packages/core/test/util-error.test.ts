import { describe, expect, it } from "bun:test"
import { Cause, Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"

const WithMessage = NamedError.create("FooError", { message: Schema.String })
const NoMessage = NamedError.create("BarError", { providerID: Schema.String })

const prettyHead = (error: Error) => Cause.pretty(Cause.fail(error)).split("\n")[0]

describe("NamedError rendering", () => {
  it("puts the human detail on .message and the tag on .name", () => {
    const error = new WithMessage({ message: "boom" })
    expect(error.name).toBe("FooError")
    expect(error.message).toBe("boom")
  })

  it("composes 'name: message' exactly once, with no doubled tag", () => {
    const error = new WithMessage({ message: "boom" })
    expect(error.toString()).toBe("FooError: boom")
    expect(prettyHead(error)).toBe("FooError: boom")
  })

  it("renders only the tag when data has no message field", () => {
    const error = new NoMessage({ providerID: "anthropic" })
    expect(error.message).toBe("")
    expect(error.toString()).toBe("BarError")
    // Cause.pretty composes "${name}: ${message}" unconditionally, so an empty message
    // leaves a trailing ": " here. Acceptable; the log path uses toString(), which omits it.
    expect(prettyHead(error)).toBe("BarError: ")
  })

  it("ignores a non-string message field", () => {
    const error = new WithMessage({ message: undefined as unknown as string })
    expect(error.message).toBe("")
    expect(error.toString()).toBe("FooError")
  })
})
