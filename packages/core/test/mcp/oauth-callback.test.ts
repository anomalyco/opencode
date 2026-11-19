import { describe, expect, it } from "bun:test"
import { Deferred, Effect, Exit, Option } from "effect"
import { handleOauthCallback } from "../../src/mcp/oauth.js"

class MockResponse {
  statusCode = 0
  body = ""
  writeHead(status: number, _headers?: Record<string, string>) {
    this.statusCode = status
    return this
  }
  end(body: string) {
    this.body = body
  }
}

const makeDeferred = () =>
  Deferred.make<{ code: string; iss?: string; host?: string; response?: MockResponse }, Error>()

const fields = { server: "test", methodID: "test", oauthAttemptID: "test" }

describe("OAuth callback handler", () => {
  it("does not fail the Deferred on error callback with correct state (replayed consent)", () => {
    const code = makeDeferred()
    const response = new MockResponse()
    const url = new URL(
      "http://127.0.0.1/callback?error=access_denied&error_description=The+consent+verifier+has+already+been+used.&state=abc123",
    )

    handleOauthCallback({
      url,
      expectedState: "abc123",
      code,
      fields,
      runFork: () => {},
      provider: "test",
      response,
    })

    // Deferred must NOT be settled — a valid code callback may still arrive.
    const poll = Effect.runSync(Deferred.poll(code))
    expect(Option.isNone(poll)).toBe(true)
    // The browser still gets an error page for this request.
    expect(response.statusCode).toBe(400)
  })

  it("succeeds the Deferred when a valid code callback arrives after an error", () => {
    const code = makeDeferred()
    const response = new MockResponse()

    // First: replayed error with correct state — must not settle the Deferred.
    const errorUrl = new URL(
      "http://127.0.0.1/callback?error=access_denied&error_description=The+consent+verifier+has+already+been+used.&state=abc123",
    )
    handleOauthCallback({
      url: errorUrl,
      expectedState: "abc123",
      code,
      fields,
      runFork: () => {},
      provider: "test",
      response,
    })
    expect(Option.isNone(Effect.runSync(Deferred.poll(code)))).toBe(true)

    // Then: the browser's real code callback with the same state — must succeed.
    const codeUrl = new URL("http://127.0.0.1/callback?code=valid-code&state=abc123")
    const codeResponse = new MockResponse()
    handleOauthCallback({
      url: codeUrl,
      expectedState: "abc123",
      code,
      fields,
      runFork: () => {},
      provider: "test",
      response: codeResponse,
    })

    const settled = Effect.runSync(Deferred.poll(code))
    expect(Option.isSome(settled)).toBe(true)
    if (Option.isSome(settled)) {
      expect(Exit.isSuccess(settled.value)).toBe(true)
      if (Exit.isSuccess(settled.value)) {
        expect(settled.value.value.code).toBe("valid-code")
      }
    }
    expect(codeResponse.statusCode).toBe(200)
  })

  it("fails the Deferred on error callback with wrong state", () => {
    const code = makeDeferred()
    const response = new MockResponse()
    const url = new URL(
      "http://127.0.0.1/callback?error=access_denied&error_description=denied&state=wrong-state",
    )

    handleOauthCallback({
      url,
      expectedState: "abc123",
      code,
      fields,
      runFork: () => {},
      provider: "test",
      response,
    })

    const settled = Effect.runSync(Deferred.poll(code))
    expect(Option.isSome(settled)).toBe(true)
    if (Option.isSome(settled)) {
      expect(Exit.isFailure(settled.value)).toBe(true)
    }
  })

  it("fails the Deferred on code callback with wrong state", () => {
    const code = makeDeferred()
    const response = new MockResponse()
    const url = new URL("http://127.0.0.1/callback?code=valid-code&state=wrong-state")

    handleOauthCallback({
      url,
      expectedState: "abc123",
      code,
      fields,
      runFork: () => {},
      provider: "test",
      response,
    })

    const settled = Effect.runSync(Deferred.poll(code))
    expect(Option.isSome(settled)).toBe(true)
    if (Option.isSome(settled)) {
      expect(Exit.isFailure(settled.value)).toBe(true)
    }
  })

  it("returns 409 when a second code callback arrives after the Deferred is settled", () => {
    const code = makeDeferred()
    const firstResponse = new MockResponse()
    const secondResponse = new MockResponse()
    const url = new URL("http://127.0.0.1/callback?code=valid-code&state=abc123")

    handleOauthCallback({
      url,
      expectedState: "abc123",
      code,
      fields,
      runFork: () => {},
      provider: "test",
      response: firstResponse,
    })
    expect(firstResponse.statusCode).toBe(200)

    handleOauthCallback({
      url,
      expectedState: "abc123",
      code,
      fields,
      runFork: () => {},
      provider: "test",
      response: secondResponse,
    })
    expect(secondResponse.statusCode).toBe(409)
  })

  it("returns 400 for a preflight with no OAuth parameters", () => {
    const code = makeDeferred()
    const response = new MockResponse()
    const url = new URL("http://127.0.0.1/callback")

    handleOauthCallback({
      url,
      expectedState: "abc123",
      code,
      fields,
      runFork: () => {},
      provider: "test",
      response,
    })

    expect(response.statusCode).toBe(400)
    expect(Option.isNone(Effect.runSync(Deferred.poll(code)))).toBe(true)
  })
})
