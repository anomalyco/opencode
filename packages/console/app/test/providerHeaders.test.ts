import { describe, expect, test } from "bun:test"
import { finalizeProviderHeaders } from "../src/routes/zen/util/providerHeaders"

describe("finalizeProviderHeaders", () => {
  test("preserves the session for the managed inference gateway", () => {
    const headers = finalizeProviderHeaders(
      new Headers({
        host: "opencode.ai",
        "content-length": "10",
        "x-opencode-request": "request-1",
        "x-opencode-session": "session-1",
        "x-opencode-project": "project-1",
        "x-opencode-client": "cli",
      }),
      true,
      "session-1",
    )

    expect(Object.fromEntries(headers)).toEqual({ "x-opencode-session": "session-1" })
  })

  test("does not forward the session to a provider", () => {
    const headers = finalizeProviderHeaders(new Headers({ "x-opencode-session": "session-1" }), false, "session-1")

    expect(headers.has("x-opencode-session")).toBe(false)
  })

  test("does not create an empty managed inference session", () => {
    const headers = finalizeProviderHeaders(new Headers({ "x-opencode-session": "ignored" }), true, "")

    expect(headers.has("x-opencode-session")).toBe(false)
  })
})
